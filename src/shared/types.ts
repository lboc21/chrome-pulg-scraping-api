/** 去重模式：loose 忽略参数顺序与动态参数；strict 完全按原始 URL 去重 */
export type DedupeMode = 'loose' | 'strict';

export interface RecorderConfig {
  /** 需要记录的目标站点（归一化后的 host 或域名） */
  sites: string[];
  /** 需要记录的请求方法 */
  methods: string[];
  dedupeMode: DedupeMode;
  /** loose 模式下视为「动态噪声」而被忽略的查询参数名 */
  ignoreParams: string[];
  captureRequestBody: boolean;
  captureResponseBody: boolean;
  /** 是否同时记录 js/css/图片等静态资源 */
  includeStatic: boolean;
  paused: boolean;
  /** 单个请求体 / 响应体的最大保存字符数 */
  maxBodyChars: number;
}

/** 一条采集到的网络请求记录（同一 key 只保留一条，后续覆盖前者） */
export interface CapturedRequest {
  id: string;
  /** 去重键：method + 归一化 URL */
  key: string;
  /** 本次「发生」的唯一标识，用于区分「同一次请求的不同阶段事件」与「重复请求」 */
  occurrenceId: string;
  /** 归属站点（命中的配置站点） */
  site: string;
  method: string;
  url: string;
  origin: string;
  path: string;
  query: Array<[string, string]>;
  requestBody?: string;
  requestHeaders?: Record<string, string>;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  contentType?: string;
  resourceType?: string;
  duration?: number;
  size?: number;
  pageUrl?: string;
  error?: string;
  /** 各采集来源（wr=webRequest / hk=hook）最近一次的 occurrenceId */
  sourceLast: Record<string, string>;
  /** 各采集来源捕获到的独立请求次数，hitCount 取其最大值 */
  sourceCount: Record<string, number>;
  /** 命中次数：同一请求第 N 次出现时累加，内容被最后一次覆盖 */
  hitCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

/** content script 侧采集到、尚未入库的原始数据 */
export interface RawCapture {
  occurrenceId: string;
  method: string;
  url: string;
  /** 事件发生时间戳（ms） */
  at: number;
  requestBody?: string;
  requestHeaders?: Record<string, string>;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  contentType?: string;
  resourceType?: string;
  duration?: number;
  size?: number;
  pageUrl?: string;
  error?: string;
}

export type RecordsMap = Record<string, CapturedRequest[]>;

export interface PopupState {
  config: RecorderConfig;
  records: RecordsMap;
  total: number;
}
