import {
  CONFIG_KEY,
  DEFAULT_CONFIG,
  RECORDS_KEY,
  countRecords,
  matchSite,
  normalizeConfig,
  safeUrl
} from '../shared/config';
import { upsertRecord } from '../shared/merge';
import type { RawCapture, RecorderConfig, RecordsMap } from '../shared/types';

const PERSIST_DELAY = 250;

/** main_frame 本身就是页面，csp_report 无分析价值 */
const SKIP_TYPES = new Set(['main_frame', 'csp_report']);
const STATIC_TYPES = new Set(['script', 'stylesheet', 'image', 'font', 'media', 'object', 'sub_frame']);
const XHR_LIKE_TYPES = new Set(['xmlhttprequest', 'ping', 'webbundle', 'other']);

// ---------------------------------------------------------------- 配置

let config: RecorderConfig = DEFAULT_CONFIG;

const configReady: Promise<void> = chrome.storage.local
  .get(CONFIG_KEY)
  .then(data => {
    config = normalizeConfig(data?.[CONFIG_KEY]);
  })
  .catch(() => undefined);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[CONFIG_KEY]) return;
  config = normalizeConfig(changes[CONFIG_KEY].newValue);
});

// ---------------------------------------------------------------- 存储（内存缓存 + 串行写入）

let cache: RecordsMap | null = null;
let loadPromise: Promise<RecordsMap> | null = null;
let chain: Promise<unknown> = Promise.resolve();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function ensureCache(): Promise<RecordsMap> {
  if (cache) return Promise.resolve(cache);
  if (!loadPromise) {
    loadPromise = chrome.storage.local
      .get(RECORDS_KEY)
      .then(data => {
        cache = (data?.[RECORDS_KEY] as RecordsMap) || {};
        return cache;
      })
      .catch(() => {
        cache = {};
        return cache as RecordsMap;
      });
  }
  return loadPromise;
}

/** 所有共享存储的修改都排队执行，避免并发 read-modify-write 互相覆盖 */
function serialize<T>(task: () => Promise<T> | T): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const snapshot = cache;
    if (!snapshot) return;
    chain = chain
      .then(() => chrome.storage.local.set({ [RECORDS_KEY]: snapshot }))
      .catch(err => console.error('[NetRecorder] 持久化失败', err));
  }, PERSIST_DELAY);
}

// ---------------------------------------------------------------- 记录合并

function ingest(site: string, raw: RawCapture): void {
  void serialize(async () => {
    const map = await ensureCache();
    const list = map[site] || (map[site] = []);
    upsertRecord(list, site, raw, config);
    schedulePersist();
    updateBadge();
  });
}

// ---------------------------------------------------------------- 徽标

function silently(handle: unknown): void {
  if (handle && typeof (handle as Promise<unknown>).catch === 'function') {
    (handle as Promise<unknown>).catch(() => undefined);
  }
}

function updateBadge(): void {
  const total = cache ? countRecords(cache) : 0;
  silently(chrome.action.setBadgeBackgroundColor({ color: '#1677ff' }));
  silently(chrome.action.setBadgeText({ text: total > 0 ? String(total) : '' }));
}

// ---------------------------------------------------------------- webRequest 采集

interface DetailsLike {
  requestId: string;
  url: string;
  method: string;
  type: string;
  tabId: number;
  timeStamp: number;
  documentUrl?: string;
  initiator?: string;
  statusCode?: number;
  statusLine?: string;
  error?: string;
}

interface BodyLike {
  error?: string;
  formData?: Record<string, string[]>;
  raw?: Array<{ bytes?: ArrayBuffer }>;
}

interface HeaderLike {
  name: string;
  value?: string;
}

/** 请求发起页所属的目标站点 */
function resolveSite(details: DetailsLike): string | null {
  const candidates = [details.documentUrl, details.initiator];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = safeUrl(candidate);
    if (!parsed) continue;
    const matched = matchSite(parsed.hostname, config.sites);
    if (matched) return matched;
  }
  return null;
}

function allowType(type: string): boolean {
  if (SKIP_TYPES.has(type)) return false;
  if (XHR_LIKE_TYPES.has(type)) return true;
  return config.includeStatic && STATIC_TYPES.has(type);
}

function shouldCapture(details: DetailsLike): string | null {
  if (!/^https?:/i.test(details.url)) return null;
  if (config.paused) return null;
  if (!config.methods.includes(details.method)) return null;
  if (!allowType(details.type)) return null;
  return resolveSite(details);
}

function headersToObject(headers?: HeaderLike[]): Record<string, string> | undefined {
  if (!headers?.length) return undefined;
  const result: Record<string, string> = {};
  for (const header of headers) {
    if (!header?.name) continue;
    result[header.name.toLowerCase()] = header.value ?? '';
  }
  return result;
}

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  return headers?.[name];
}

function extractRequestBody(body: BodyLike | undefined): string | undefined {
  if (!body) return undefined;
  if (body.formData) {
    return Object.entries(body.formData)
      .map(([name, values]) => `${name}=${values.join(',')}`)
      .join('&');
  }
  if (body.raw?.length) {
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const text = body.raw.map(part => (part.bytes ? decoder.decode(part.bytes) : '')).join('');
    if (!text) return undefined;
    // 二进制内容用可读描述替代，避免存储乱码
    if (/[\x00-\x08\x0E-\x1F]/.test(text)) {
      const bytes = body.raw.reduce((sum, part) => sum + (part.bytes?.byteLength || 0), 0);
      return `[二进制数据 ${bytes} 字节]`;
    }
    return text;
  }
  return body.error ? `[请求体不可读: ${body.error}]` : undefined;
}

const startedAt = new Map<string, number>();

chrome.webRequest.onBeforeRequest.addListener(
  details => {
    void (async () => {
      await configReady;
      const raw = details as unknown as DetailsLike & { requestBody?: BodyLike };
      const site = shouldCapture(raw);
      if (!site) return;
      startedAt.set(raw.requestId, raw.timeStamp);
      if (startedAt.size > 2000) startedAt.clear();
      ingest(site, {
        occurrenceId: `wr:${raw.requestId}`,
        method: raw.method,
        url: raw.url,
        at: raw.timeStamp || Date.now(),
        requestBody: config.captureRequestBody ? extractRequestBody(raw.requestBody) : undefined,
        resourceType: raw.type,
        pageUrl: raw.documentUrl || raw.initiator
      });
    })();
    return undefined;
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

chrome.webRequest.onHeadersReceived.addListener(
  details => {
    void (async () => {
      await configReady;
      const raw = details as unknown as DetailsLike & { responseHeaders?: HeaderLike[] };
      const site = shouldCapture(raw);
      if (!site) return;
      const headers = headersToObject(raw.responseHeaders);
      const length = Number(headerValue(headers, 'content-length') || 0);
      ingest(site, {
        occurrenceId: `wr:${raw.requestId}`,
        method: raw.method,
        url: raw.url,
        at: raw.timeStamp || Date.now(),
        status: raw.statusCode,
        statusText: raw.statusLine,
        responseHeaders: headers,
        contentType: headerValue(headers, 'content-type'),
        size: Number.isFinite(length) && length > 0 ? length : undefined,
        resourceType: raw.type,
        pageUrl: raw.documentUrl || raw.initiator
      });
    })();
    return undefined;
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

chrome.webRequest.onCompleted.addListener(
  details => {
    void (async () => {
      await configReady;
      const raw = details as unknown as DetailsLike;
      const site = shouldCapture(raw);
      if (!site) return;
      const start = startedAt.get(raw.requestId);
      if (start) startedAt.delete(raw.requestId);
      ingest(site, {
        occurrenceId: `wr:${raw.requestId}`,
        method: raw.method,
        url: raw.url,
        at: raw.timeStamp || Date.now(),
        duration: start ? Math.round(raw.timeStamp - start) : undefined,
        resourceType: raw.type,
        pageUrl: raw.documentUrl || raw.initiator
      });
    })();
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onErrorOccurred.addListener(
  details => {
    void (async () => {
      await configReady;
      const raw = details as unknown as DetailsLike;
      const site = shouldCapture(raw);
      if (!site) return;
      startedAt.delete(raw.requestId);
      ingest(site, {
        occurrenceId: `wr:${raw.requestId}`,
        method: raw.method,
        url: raw.url,
        at: raw.timeStamp || Date.now(),
        error: raw.error,
        resourceType: raw.type,
        pageUrl: raw.documentUrl || raw.initiator
      });
    })();
  },
  { urls: ['<all_urls>'] }
);

// ---------------------------------------------------------------- 消息处理

interface Message {
  type: string;
  site?: string | null;
  raw?: RawCapture;
  id?: string;
  config?: Partial<RecorderConfig>;
}

async function handleMessage(message: Message): Promise<unknown> {
  switch (message.type) {
    case 'CAPTURE': {
      if (!message.raw || !message.site) return { ok: false };
      await configReady;
      if (!config.sites.includes(message.site)) return { ok: false };
      ingest(message.site, message.raw);
      return { ok: true };
    }
    case 'GET_STATE': {
      await configReady;
      const map = await ensureCache();
      return { config, records: map, total: countRecords(map) };
    }
    case 'SET_CONFIG': {
      const next = normalizeConfig(message.config);
      config = next;
      await chrome.storage.local.set({ [CONFIG_KEY]: next });
      return { ok: true, config: next };
    }
    case 'CLEAR_RECORDS': {
      return serialize(async () => {
        const map = await ensureCache();
        if (message.site) delete map[message.site];
        else for (const key of Object.keys(map)) delete map[key];
        await chrome.storage.local.set({ [RECORDS_KEY]: map });
        updateBadge();
        return { ok: true };
      });
    }
    case 'DELETE_RECORD': {
      return serialize(async () => {
        const map = await ensureCache();
        const site = message.site;
        if (site && message.id && map[site]) {
          map[site] = map[site].filter(item => item.id !== message.id);
          await chrome.storage.local.set({ [RECORDS_KEY]: map });
          updateBadge();
        }
        return { ok: true };
      });
    }
    default:
      return { ok: false, error: `未知消息类型: ${message.type}` };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message as Message)
    .then(result => sendResponse(result))
    .catch(err => {
      console.error('[NetRecorder] 消息处理失败', err);
      sendResponse({ ok: false, error: String(err) });
    });
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureCache().then(updateBadge);
});

chrome.runtime.onStartup.addListener(() => {
  void ensureCache().then(updateBadge);
});
