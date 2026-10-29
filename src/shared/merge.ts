import { buildRecordKey, safeUrl } from './config';
import type { CapturedRequest, RawCapture, RecorderConfig } from './types';

/** 单站点最多保留的记录条数，超出后丢弃最旧（列表尾部）的记录 */
export const MAX_RECORDS_PER_SITE = 300;

const MERGE_FIELDS = [
  'requestBody',
  'requestHeaders',
  'status',
  'statusText',
  'responseHeaders',
  'responseBody',
  'contentType',
  'resourceType',
  'duration',
  'size',
  'pageUrl',
  'error'
] as const;

function buildRecord(site: string, key: string, raw: RawCapture, at: number): CapturedRequest {
  const parsed = safeUrl(raw.url);
  const source = sourceOf(raw);
  return {
    id: `${at.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    key,
    occurrenceId: raw.occurrenceId,
    site,
    method: raw.method,
    url: raw.url,
    origin: parsed?.origin || '',
    path: parsed?.pathname || '',
    query: parsed ? Array.from(parsed.searchParams.entries()) : [],
    requestBody: raw.requestBody,
    requestHeaders: raw.requestHeaders,
    status: raw.status,
    statusText: raw.statusText,
    responseHeaders: raw.responseHeaders,
    responseBody: raw.responseBody,
    contentType: raw.contentType,
    resourceType: raw.resourceType,
    duration: raw.duration,
    size: raw.size,
    pageUrl: raw.pageUrl,
    error: raw.error,
    sourceLast: { [source]: raw.occurrenceId },
    sourceCount: { [source]: 1 },
    hitCount: 1,
    firstSeenAt: at,
    lastSeenAt: at
  };
}

/** occurrenceId 形如 `wr:123` / `hk:abc`，前缀即采集来源 */
function sourceOf(raw: RawCapture): string {
  const index = String(raw.occurrenceId || '').indexOf(':');
  return index > 0 ? raw.occurrenceId.slice(0, index) : 'unknown';
}

/** 用新事件补齐/覆盖旧字段，但不会用空值把已有内容冲掉 */
function mergeRecord(prev: CapturedRequest, raw: RawCapture): CapturedRequest {
  const parsed = safeUrl(raw.url);
  const next: CapturedRequest = {
    ...prev,
    occurrenceId: raw.occurrenceId,
    url: raw.url,
    origin: parsed?.origin || prev.origin,
    path: parsed?.pathname || prev.path,
    query: parsed ? Array.from(parsed.searchParams.entries()) : prev.query
  };
  const source = raw as unknown as Record<string, unknown>;
  const target = next as unknown as Record<string, unknown>;
  for (const field of MERGE_FIELDS) {
    const value = source[field];
    if (value !== undefined && value !== null && value !== '') target[field] = value;
  }
  return next;
}

/**
 * 写入一条采集数据：
 * - key 相同视为「同一个具体请求」，只保留一条记录，内容被最新一次覆盖
 * - 同一次请求会被 webRequest 与 hook 各上报一次，因此命中次数按来源分别去重后取最大值
 * - 记录始终按最近出现时间倒序排列在列表头部
 */
export function upsertRecord(
  list: CapturedRequest[],
  site: string,
  raw: RawCapture,
  config: Pick<RecorderConfig, 'dedupeMode' | 'ignoreParams'>
): CapturedRequest {
  const key = buildRecordKey(raw.method, raw.url, config);
  const at = raw.at || Date.now();
  const index = list.findIndex(item => item.key === key);

  if (index === -1) {
    const created = buildRecord(site, key, raw, at);
    list.unshift(created);
    if (list.length > MAX_RECORDS_PER_SITE) list.length = MAX_RECORDS_PER_SITE;
    return created;
  }

  const prev = list[index];
  const merged = mergeRecord(prev, raw);

  const source = sourceOf(raw);
  const sourceLast = { ...prev.sourceLast };
  const sourceCount = { ...prev.sourceCount };
  if (sourceLast[source] !== raw.occurrenceId) {
    sourceLast[source] = raw.occurrenceId;
    sourceCount[source] = (sourceCount[source] || 0) + 1;
  }
  merged.sourceLast = sourceLast;
  merged.sourceCount = sourceCount;
  merged.hitCount = Math.max(1, ...Object.values(sourceCount));

  merged.firstSeenAt = prev.firstSeenAt;
  merged.lastSeenAt = Math.max(prev.lastSeenAt, at);
  list.splice(index, 1);
  list.unshift(merged);
  if (list.length > MAX_RECORDS_PER_SITE) list.length = MAX_RECORDS_PER_SITE;
  return merged;
}
