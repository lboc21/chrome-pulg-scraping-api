/**
 * MAIN world 注入脚本（运行在页面上下文）。
 *
 * MV3 的 webRequest 拿不到响应体，所以这里劫持页面的 fetch / XMLHttpRequest，
 * 拿到真实请求参数与响应内容，再通过 window.postMessage 交给隔离世界的 bridge 脚本转投 Service Worker。
 */
const MSG_FLAG = '__NET_RECORDER_MSG__';
const ACTIVE_FLAG = '__NET_RECORDER_ACTIVE__';
const HOOK_FLAG = '__NET_RECORDER_HOOKED__';
const MAX_BODY_CHARS = 300_000;

type Dict = Record<string, string>;

interface HookPayload {
  occurrenceId: string;
  method: string;
  url: string;
  requestBody?: string;
  requestHeaders?: Dict;
  status?: number;
  statusText?: string;
  responseHeaders?: Dict;
  responseBody?: string;
  contentType?: string;
  resourceType: string;
  duration?: number;
  size?: number;
  error?: string;
}

(function install(): void {
  const page = window as unknown as Record<string, unknown>;
  if (page[HOOK_FLAG]) return;
  page[HOOK_FLAG] = true;

  // 仅当当前页面命中配置站点时才真正采集（由 bridge 脚本下发），避免在无关站点上读取响应体
  let active = false;
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || data[ACTIVE_FLAG] === undefined) return;
    active = data[ACTIVE_FLAG] === true;
  });

  const truncate = (input?: string): string | undefined => {
    if (typeof input !== 'string' || !input) return undefined;
    if (input.length <= MAX_BODY_CHARS) return input;
    return `${input.slice(0, MAX_BODY_CHARS)}\n…[内容过长已截断，原始长度 ${input.length} 字符]`;
  };

  const isTextual = (contentType: string): boolean => {
    const ct = (contentType || '').toLowerCase();
    if (!ct) return false;
    if (ct.includes('text/event-stream')) return false; // SSE 会一直挂起，跳过
    return /json|javascript|ecmascript|xml|text\/|x-www-form-urlencoded|graphql|plain/.test(ct);
  };

  const headersToObject = (headers: Headers): Dict => {
    const result: Dict = {};
    headers.forEach((value, name) => {
      result[name.toLowerCase()] = value;
    });
    return result;
  };

  const parseRawHeaders = (raw: string): Dict => {
    const result: Dict = {};
    raw
      .trim()
      .split(/[\r\n]+/)
      .forEach(line => {
        const index = line.indexOf(':');
        if (index < 0) return;
        const name = line.slice(0, index).trim().toLowerCase();
        const value = line.slice(index + 1).trim();
        if (name) result[name] = result[name] ? `${result[name]}, ${value}` : value;
      });
    return result;
  };

  const stringifyBody = (body: unknown): string | undefined => {
    if (body === undefined || body === null) return undefined;
    if (typeof body === 'string') return body;
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const result: Dict = {};
      body.forEach((value, name) => {
        result[name] = typeof value === 'string' ? value : `[File ${(value as File).name || 'blob'}]`;
      });
      return JSON.stringify(result);
    }
    if (body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return '[二进制请求体]';
    try {
      return JSON.stringify(body);
    } catch {
      return String(body);
    }
  };

  const emit = (payload: HookPayload): void => {
    try {
      window.postMessage(
        {
          [MSG_FLAG]: true,
          payload: { ...payload, pageUrl: location.href, timeStamp: Date.now() }
        },
        '*'
      );
    } catch {
      /* 忽略跨上下文异常 */
    }
  };

  const uid = (): string => `hk:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // ------------------------------------------------------------ fetch
  const originalFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : undefined;
  if (originalFetch) {
    window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const startedAt = Date.now();
      const occurrenceId = uid();
      let url = '';
      let method = 'GET';
      let requestBody: string | undefined;
      let requestHeaders: Dict | undefined;

      try {
        if (typeof input === 'string') url = input;
        else if (typeof URL !== 'undefined' && input instanceof URL) url = input.href;
        else url = (input as Request).url;

        const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
        method = String(init?.method || request?.method || 'GET').toUpperCase();

        const rawHeaders = init?.headers || request?.headers;
        if (rawHeaders) {
          const container = new Headers();
          new Headers(rawHeaders as HeadersInit).forEach((value, name) => {
            container.set(name, value);
          });
          requestHeaders = headersToObject(container);
        }
        requestBody = stringifyBody(init?.body);
      } catch {
        /* 解析失败不影响原始请求 */
      }

      if (!url) return originalFetch(input, init);

      const promise = originalFetch(input, init);

      // 先上报元数据，body 读取失败/页面跳转时也不会丢记录
      promise.then(
        response => {
          if (!active) return;
          try {
            const responseHeaders = headersToObject(response.headers);
            const contentType = responseHeaders['content-type'] || '';
            const base: HookPayload = {
              occurrenceId,
              method,
              url,
              requestBody,
              requestHeaders,
              status: response.status,
              statusText: response.statusText,
              responseHeaders,
              contentType,
              resourceType: 'fetch',
              duration: Date.now() - startedAt
            };
            emit(base);

            if (!isTextual(contentType)) return;
            response
              .clone()
              .text()
              .then(text => {
                emit({ ...base, responseBody: truncate(text), size: text.length, duration: Date.now() - startedAt });
              })
              .catch(() => undefined);
          } catch {
            /* 忽略 */
          }
        },
        (error: unknown) => {
          if (!active) return;
          emit({
            occurrenceId,
            method,
            url,
            requestBody,
            requestHeaders,
            resourceType: 'fetch',
            duration: Date.now() - startedAt,
            error: `请求失败: ${error instanceof Error ? error.message : String(error)}`
          });
        }
      );

      return promise;
    } as typeof window.fetch;
  }

  // ------------------------------------------------------------ XMLHttpRequest
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    interface Meta {
      occurrenceId: string;
      method: string;
      url: string;
      headers: Dict;
      startedAt: number;
      reported: boolean;
    }

    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;
    const originalSetRequestHeader = XHR.prototype.setRequestHeader;

    XHR.prototype.open = function patchedOpen(
      this: XMLHttpRequest & { __netRecorder?: Meta },
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      this.__netRecorder = {
        occurrenceId: uid(),
        method: String(method || 'GET').toUpperCase(),
        url: typeof url === 'string' ? url : url?.toString?.() || '',
        headers: {},
        startedAt: Date.now(),
        reported: false
      };
      return originalOpen.apply(this, [method, url, ...rest] as never);
    } as typeof XHR.prototype.open;

    XHR.prototype.setRequestHeader = function patchedSetRequestHeader(
      this: XMLHttpRequest & { __netRecorder?: Meta },
      name: string,
      value: string
    ) {
      if (this.__netRecorder) this.__netRecorder.headers[String(name).toLowerCase()] = String(value);
      return originalSetRequestHeader.apply(this, [name, value] as never);
    } as typeof XHR.prototype.setRequestHeader;

    XHR.prototype.send = function patchedSend(
      this: XMLHttpRequest & { __netRecorder?: Meta },
      body?: Document | XMLHttpRequestBodyInit | null
    ) {
      const xhr = this;
      const meta = xhr.__netRecorder;
      const requestBody = stringifyBody(body);

      const report = (): void => {
        if (!meta || meta.reported) return;
        meta.reported = true;
        if (!active) return;
        try {
          const responseHeaders = parseRawHeaders(xhr.getAllResponseHeaders() || '');
          const contentType = responseHeaders['content-type'] || '';
          let responseBody: string | undefined;
          const type = xhr.responseType;
          if (type === '' || type === 'text') responseBody = xhr.responseText;
          else if (type === 'json') responseBody = JSON.stringify(xhr.response ?? null);
          if (!isTextual(contentType)) responseBody = undefined;

          emit({
            occurrenceId: meta.occurrenceId,
            method: meta.method,
            url: xhr.responseURL || meta.url,
            requestBody,
            requestHeaders: meta.headers,
            status: xhr.status,
            statusText: xhr.statusText,
            responseHeaders,
            contentType,
            resourceType: 'xmlhttprequest',
            duration: Date.now() - meta.startedAt,
            responseBody: truncate(responseBody),
            size: responseBody ? responseBody.length : undefined,
            error: xhr.status === 0 ? '请求失败或被中断' : undefined
          });
        } catch {
          /* 忽略 */
        }
      };

      xhr.addEventListener('loadend', report);
      return originalSend.call(this, body);
    } as typeof XHR.prototype.send;
  }
})();
