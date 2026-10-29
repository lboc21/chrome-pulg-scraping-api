import assert from 'node:assert/strict';
import { buildRecordKey, DEFAULT_CONFIG, matchSite, normalizeConfig, normalizeSiteInput } from '../src/shared/config';
import { upsertRecord } from '../src/shared/merge';
import type { CapturedRequest, RawCapture } from '../src/shared/types';

const config = normalizeConfig(DEFAULT_CONFIG);

// ---- 站点归一化
assert.equal(normalizeSiteInput('www.baidu.com'), 'www.baidu.com');
assert.equal(normalizeSiteInput('  https://WWW.Baidu.com/s?wd=1  '), 'www.baidu.com');
assert.equal(normalizeSiteInput('*.baidu.com'), 'baidu.com');
assert.equal(normalizeSiteInput('http://localhost:3000/api'), 'localhost');
assert.equal(normalizeSiteInput('!!!'), null);

// ---- 站点匹配
assert.equal(matchSite('www.baidu.com', ['www.baidu.com']), 'www.baidu.com');
assert.equal(matchSite('baidu.com', ['www.baidu.com']), 'www.baidu.com');
assert.equal(matchSite('m.baidu.com', ['baidu.com']), 'baidu.com');
assert.equal(matchSite('m.baidu.com', ['www.baidu.com']), null);
assert.equal(matchSite('www.baidu.com.evil.com', ['www.baidu.com']), null);

// ---- 去重 key
const loose = buildRecordKey('get', 'https://www.baidu.com/s?wd=a&_t=123', config);
const looseSameOrder = buildRecordKey('GET', 'https://www.baidu.com/s?wd=a&_t=999', config);
const looseOtherParam = buildRecordKey('GET', 'https://www.baidu.com/s?wd=b&_t=123', config);
assert.equal(loose, 'GET https://www.baidu.com/s?wd=a');
assert.equal(loose, looseSameOrder);
assert.notEqual(loose, looseOtherParam);

const strictConfig = normalizeConfig({ ...config, dedupeMode: 'strict' });
assert.notEqual(
  buildRecordKey('GET', 'https://www.baidu.com/s?wd=a&_t=1', strictConfig),
  buildRecordKey('GET', 'https://www.baidu.com/s?wd=a&_t=2', strictConfig)
);

// ---- 记录去重 / 覆盖
const list: CapturedRequest[] = [];
const base = (over: Partial<RawCapture>): RawCapture => ({
  occurrenceId: 'wr:1',
  method: 'GET',
  url: 'https://www.baidu.com/api/user',
  at: 1000,
  ...over
});

// 1) 首次采集
upsertRecord(list, 'www.baidu.com', base({}), config);
assert.equal(list.length, 1);
assert.equal(list[0].hitCount, 1);

// 2) 同一次请求的多个阶段事件（headers / hook body）→ 次数仍为 1，字段补齐
upsertRecord(
  list,
  'www.baidu.com',
  base({ at: 1010, occurrenceId: 'wr:1', status: 200, responseHeaders: { 'content-type': 'application/json' } }),
  config
);
upsertRecord(
  list,
  'www.baidu.com',
  base({ at: 1020, occurrenceId: 'hk:1', responseBody: '{"id":1}', duration: 20 }),
  config
);
assert.equal(list.length, 1);
assert.equal(list[0].hitCount, 1, 'webRequest 与 hook 各上报一次不算两次请求');
assert.equal(list[0].status, 200);
assert.equal(list[0].responseBody, '{"id":1}');
assert.equal(list[0].duration, 20);
assert.equal(list[0].firstSeenAt, 1000);

// 3) 第二次真实请求（参数顺序不同 + 动态参数不同，宽松模式仍视为同一请求）→ 覆盖内容
upsertRecord(
  list,
  'www.baidu.com',
  base({ occurrenceId: 'wr:2', at: 2000, url: 'https://www.baidu.com/api/user?_t=999' }),
  config
);
assert.equal(list[0].hitCount, 2);
upsertRecord(
  list,
  'www.baidu.com',
  base({ occurrenceId: 'hk:2', at: 2010, url: 'https://www.baidu.com/api/user?_t=999', responseBody: '{"id":2}' }),
  config
);
assert.equal(list.length, 1);
assert.equal(list[0].responseBody, '{"id":2}');
assert.equal(list[0].hitCount, 2);
assert.equal(list[0].lastSeenAt, 2010);

// 4) 不同参数值 → 新记录，且排在最前
upsertRecord(
  list,
  'www.baidu.com',
  { ...base({}), url: 'https://www.baidu.com/api/user?page=2', occurrenceId: 'wr:2', at: 3000 },
  config
);
assert.equal(list.length, 2);
assert.equal(list[0].url, 'https://www.baidu.com/api/user?page=2');

// 5) POST 同 URL 与 GET 不冲突
upsertRecord(
  list,
  'www.baidu.com',
  { ...base({}), method: 'POST', occurrenceId: 'wr:3', at: 4000, requestBody: '{"a":1}' },
  config
);
assert.equal(list.length, 3);
assert.equal(list[0].method, 'POST');
assert.equal(list[0].requestBody, '{"a":1}');

// 6) 空值不覆盖已有内容
upsertRecord(list, 'www.baidu.com', base({ occurrenceId: 'wr:9', at: 5000, status: 500 }), config);
const apiKey = buildRecordKey('GET', 'https://www.baidu.com/api/user', config);
const target = list.find(item => item.key === apiKey)!;
assert.equal(target.status, 500);
assert.equal(target.responseBody, '{"id":2}', '新事件没带 body 时不应清空旧 body');

console.log('全部断言通过 ✅');
