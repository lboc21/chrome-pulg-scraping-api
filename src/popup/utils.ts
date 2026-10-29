import type { CapturedRequest } from '../shared/types';

const METHOD_COLORS: Record<string, string> = {
  GET: 'blue',
  POST: 'green',
  PUT: 'orange',
  PATCH: 'purple',
  DELETE: 'red',
  HEAD: 'default',
  OPTIONS: 'default'
};

export function methodColor(method: string): string {
  return METHOD_COLORS[method?.toUpperCase()] || 'default';
}

export function statusColor(status?: number): string {
  if (!status) return 'default';
  if (status < 300) return 'success';
  if (status < 400) return 'processing';
  if (status < 500) return 'warning';
  return 'error';
}

/** 状态点样式：与列表、抽屉共用一套色板 */
export function statusClass(record: CapturedRequest): string {
  const status = record.status || 0;
  if (record.error && !status) return 'is-error';
  if (!status) return 'is-pending';
  if (status < 300) return 'is-ok';
  if (status < 400) return 'is-redirect';
  if (status < 500) return 'is-warn';
  return 'is-error';
}

export function formatBytes(size?: number): string {
  if (size === undefined || size === null) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

const pad = (value: number) => String(value).padStart(2, '0');

export function formatTime(timestamp?: number): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatDateTime(timestamp?: number): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

/** JSON 格式化，非 JSON 原样返回 */
export function prettyText(text?: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (!trimmed) return text;
  const first = trimmed[0];
  if (first !== '{' && first !== '[') return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}

/** 仅当请求域名与站点点位不同（子域名/第三方）时才展示 host，避免重复占位 */
export function hostOf(record: CapturedRequest): string {
  try {
    const hostname = new URL(record.url).hostname;
    return hostname === record.site ? '' : hostname;
  } catch {
    return '';
  }
}

/** 请求是否为第三方域名 */
export function isThirdParty(record: CapturedRequest): boolean {
  try {
    const host = new URL(record.url).hostname;
    return !(host === record.site || host.endsWith(`.${record.site}`));
  } catch {
    return false;
  }
}

export function recordSize(record: CapturedRequest): number | undefined {
  if (record.size) return record.size;
  if (record.responseBody) return record.responseBody.length;
  return undefined;
}

export function headersEntries(headers?: Record<string, string>): Array<{ name: string; value: string }> {
  if (!headers) return [];
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}
