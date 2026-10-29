/**
 * 隔离世界 bridge 脚本：
 * 接收 MAIN world 通过 window.postMessage 发来的请求数据，按配置过滤后转投 Service Worker。
 */
import { DEFAULT_CONFIG, normalizeConfig, matchSite, truncateText } from '../shared/config';
import type { RawCapture, RecorderConfig } from '../shared/types';

const MSG_FLAG = '__NET_RECORDER_MSG__';
const ACTIVE_FLAG = '__NET_RECORDER_ACTIVE__';
const FLUSH_DELAY = 120;
const MAX_PENDING = 800;

let config: RecorderConfig = DEFAULT_CONFIG;

const ready = new Promise<void>(resolve => {
  try {
    chrome.storage.local.get('config', data => {
      config = normalizeConfig(data?.config);
      resolve();
    });
  } catch {
    resolve();
  }
});

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.config) return;
    config = normalizeConfig(changes.config.newValue);
    publishActive();
  });
} catch {
  /* 扩展被重新加载后旧上下文会失效 */
}

/** 告知 MAIN world 的 hook 是否需要采集（页面未命中配置站点时完全不采） */
function publishActive(): void {
  try {
    const matched = !!matchSite(location.hostname, config.sites);
    window.postMessage({ [ACTIVE_FLAG]: matched && !config.paused }, '*');
  } catch {
    /* 忽略 */
  }
}

void ready.then(publishActive);

const pending: Array<{ site: string; raw: RawCapture }> = [];
let timer: number | null = null;

function scheduleFlush(): void {
  if (timer !== null) return;
  timer = window.setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_DELAY);
}

async function flush(): Promise<void> {
  if (!pending.length) return;
  const batch = pending.splice(0, pending.length);
  await Promise.all(batch.map(({ site, raw }) => send(site, raw)));
}

async function send(site: string, raw: RawCapture, retry = true): Promise<void> {
  const message = { type: 'CAPTURE', site, raw };
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    if (!retry) return;
    // Service Worker 刚被唤醒时首次 sendMessage 可能失败，重试一次
    await new Promise(resolve => setTimeout(resolve, 200));
    try {
      await chrome.runtime.sendMessage(message);
    } catch {
      /* 放弃这一条，避免阻塞队列 */
    }
  }
}

function sanitize(raw: RawCapture): RawCapture {
  const max = config.maxBodyChars || DEFAULT_CONFIG.maxBodyChars;
  const next: RawCapture = { ...raw, method: String(raw.method || 'GET').toUpperCase() };
  next.requestBody = config.captureRequestBody ? truncateText(raw.requestBody, max) : undefined;
  next.responseBody = config.captureResponseBody ? truncateText(raw.responseBody, max) : undefined;
  return next;
}

async function handle(raw: RawCapture): Promise<void> {
  await ready;
  if (config.paused) return;
  if (!config.sites.length) return;

  const site = matchSite(location.hostname, config.sites);
  if (!site) return;
  if (!config.methods.includes(String(raw.method || 'GET').toUpperCase())) return;

  if (pending.length >= MAX_PENDING) pending.shift();
  pending.push({ site, raw: sanitize(raw) });
  scheduleFlush();
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as Record<string, unknown> | null;
  if (!data || data[MSG_FLAG] !== true) return;
  const raw = data.payload as RawCapture | undefined;
  if (!raw || typeof raw.url !== 'string' || !raw.url) return;
  void handle(raw);
});
