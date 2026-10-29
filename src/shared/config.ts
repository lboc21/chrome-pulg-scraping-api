import type { DedupeMode, RecorderConfig, RecordsMap } from './types';

export const CONFIG_KEY = 'config';
export const RECORDS_KEY = 'records';

export const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export const DEFAULT_CONFIG: RecorderConfig = {
  sites: [],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  dedupeMode: 'loose',
  ignoreParams: ['_t', '_', 'timestamp', 'ts', 'nonce', 'requestId', 'reqTime'],
  captureRequestBody: true,
  captureResponseBody: true,
  includeStatic: false,
  paused: false,
  maxBodyChars: 100_000
};

export function normalizeConfig(input?: unknown): RecorderConfig {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<RecorderConfig>;
  const merged: RecorderConfig = { ...DEFAULT_CONFIG, ...source };
  return {
    ...merged,
    sites: Array.from(new Set((merged.sites || []).map(s => normalizeSiteInput(s)).filter((s): s is string => !!s))),
    methods: (merged.methods || DEFAULT_CONFIG.methods).map(m => String(m).toUpperCase()),
    ignoreParams: merged.ignoreParams || [],
    maxBodyChars: Math.min(Math.max(merged.maxBodyChars || DEFAULT_CONFIG.maxBodyChars, 1000), 1_000_000)
  };
}

/** 把 "https://www.baidu.com/s?wd=1" / "www.baidu.com" / "*.baidu.com" 归一化成匹配用的 host */
export function normalizeSiteInput(input: string): string | null {
  if (!input) return null;
  let value = String(input).trim().toLowerCase();
  if (!value) return null;
  value = value.split(/\s+/)[0];
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.replace(/[/?#].*$/, '');
  value = value.replace(/:\d+$/, '');
  value = value.replace(/^\*\./, '');
  value = value.replace(/\.+$/, '');
  if (!value) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(value)) return null;
  return value;
}

/** 判断 hostname 是否命中配置站点，返回命中的站点点位（用作记录分组） */
export function matchSite(hostname: string, sites: string[]): string | null {
  if (!hostname) return null;
  const host = hostname.toLowerCase();
  for (const site of sites) {
    if (host === site) return site;
    if (host.endsWith(`.${site}`)) return site;
    // 用户输入 www.baidu.com 时同时兼容裸域名 baidu.com
    if (site.endsWith(`.${host}`) && site.split('.').length - host.split('.').length === 1) return site;
  }
  return null;
}

export function safeUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * 计算去重键。同一个键的请求只保留一条记录。
 * - strict：method + 完整 URL（参数顺序不同也算不同请求）
 * - loose：method + origin + path + 排序后的参数（忽略 ignoreParams 中的动态参数）
 */
export function buildRecordKey(
  method: string,
  url: string,
  config: Pick<RecorderConfig, 'dedupeMode' | 'ignoreParams'>
): string {
  const upper = (method || 'GET').toUpperCase();
  const parsed = safeUrl(url);
  if (!parsed) return `${upper} ${url}`;
  if (config.dedupeMode === ('strict' as DedupeMode)) return `${upper} ${parsed.href}`;

  const ignore = new Set(config.ignoreParams || []);
  const entries = Array.from(parsed.searchParams.entries())
    .filter(([name]) => !ignore.has(name))
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const query = entries.map(([name, value]) => `${name}=${value}`).join('&');
  return `${upper} ${parsed.origin}${parsed.pathname}${query ? `?${query}` : ''}`;
}

export function truncateText(text: string | undefined, max: number): string | undefined {
  if (typeof text !== 'string') return undefined;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[内容过长已截断，原始长度 ${text.length} 字符]`;
}

export function countRecords(records: RecordsMap): number {
  return Object.values(records).reduce((sum, list) => sum + list.length, 0);
}
