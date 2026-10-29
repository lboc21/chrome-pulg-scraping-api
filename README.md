# NetRecorder · Chrome 网络请求记录器

在弹窗里填一个网站，之后访问该网站时自动把它发出的接口请求记录下来：**URL、请求参数（Query + Body）、响应内容、状态码、耗时、次数**。同一个请求只保留一条，重复出现时用最新内容覆盖。

> 基于 Manifest V3，需要 **Chrome 111+**（依赖 `content_scripts` 的 `world: "MAIN"`）。
> 数据只写入本地 `chrome.storage.local`，不发起任何网络请求。

## 功能

- **站点白名单**：只记录你指定的站点及其子域名。未命中站点完全不 hook，也不读取响应体，日常浏览零额外开销。
- **双路采集**：`chrome.webRequest` 负责状态码、耗时、请求/响应头等元数据；页面内的 `fetch` / `XMLHttpRequest` hook 负责请求体与响应体（这是 webRequest 拿不到的部分），两路按 key 合并。
- **去重合并**：同一请求只保留一条，后面覆盖前面，次数累计。可通过「宽松 / 严格」模式决定什么算「同一个请求」。
- **可配置范围**：请求方法、去重模式、需要忽略的动态参数、是否记录请求体 / 响应体 / 静态资源。
- **查看与导出**：方法筛选、关键词搜索（URL / 请求体 / 响应体）、详情抽屉（概览、Query 参数、请求体、响应体、标头）、整表导出 JSON。
- **暂停开关**：随时暂停记录，不用删除站点配置。

## 快速开始

```bash
npm install
npm run build
```

然后打开 `chrome://extensions`：

1. 打开右上角的「开发者模式」
2. 点击「加载已解压的扩展程序」
3. 选择项目下的 **`dist`** 目录

> 不要选项目根目录，根目录没有可用的 `manifest.json`，构建产物在 `dist`。

## 使用

1. 点击工具栏的扩展图标，输入要监控的网址（如 `www.baidu.com`，也可以直接粘贴完整链接），点「添加」。
2. 打开或切换到该网站，正常操作。
3. 再点扩展图标，记录已经写进列表了。点任意一行打开详情抽屉。

站点增删是**即时生效**的，已经打开的页面不需要刷新，也不用重新加载扩展。改了代码则需要：

| 改动位置                              | 生效方式                                 |
| ------------------------------------- | ---------------------------------------- |
| `src/popup/**`                        | 关掉弹窗再打开                           |
| `src/content/**`、`src/background/**` | 扩展管理页点「重新加载」，再刷新目标页面 |
| `public/manifest.json`                | 扩展管理页点「重新加载」                 |

## 工作原理

```
                ┌──────────────────────────────────────┐
                │  Popup（React 18 + Ant Design 5）     │
                │  站点配置 / 请求列表 / 详情 / 导出     │
                └───────────────┬──────────────────────┘
                                │ sendMessage + storage.onChanged
                ┌───────────────▼──────────────────────┐
                │  Service Worker（background.js）      │
                │  webRequest ×4 → 元数据               │
                │  内存缓存 + 串行写 + 250ms 防抖落盘    │
                │  → chrome.storage.local               │
                └────────▲──────────────▲──────────────┘
                         │ CAPTURE      │ 站点命中 / 配置
              ┌──────────┴───────┐  ┌───┴──────────────┐
              │ content-bridge   │  │ 隔离世界          │
              │ 过滤、截断、批量  │  │ window.postMessage│
              └──────────▲───────┘  └──────────────────┘
                         │ window.postMessage
              ┌──────────┴───────────────────────────┐
              │ content-inject（MAIN world）          │
              │ hook window.fetch / XMLHttpRequest    │
              └──────────────────────────────────────┘
```

补充几点实现上的取舍：

- **为什么必须 hook 页面**：MV3 的 `webRequest` 只能拿到元数据，响应体需要页面内 hook 才能读；MAIN world 脚本不能动态 import（会被页面 CSP 拦截），因此用 esbuild 打成自包含 IIFE，由 `manifest.json` 静态注入。
- **为什么写两个 content script**：MAIN world 拿不到 `chrome.*` API，隔离世界能拿到但读不到页面变量，两者用 `window.postMessage` 通信。
- **为什么存储要串行**：Service Worker 里多次 read-modify-write 会互相覆盖丢数据，这里用内存缓存 + Promise 链串行写 + 防抖落盘。
- **次数为什么不会虚高**：同一次请求会被 webRequest 和 hook 各上报一次。记录里按来源（`wr:` / `hk:`）分别统计出现次数，`hitCount` 取最大值，而不是简单累加。

## 去重规则

去重键 = 请求方法 + 归一化后的 URL。两种模式：

| 模式         | key 构成                                                                | 适用场景                                             |
| ------------ | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| 宽松（默认） | `METHOD origin + path + 排序后的 query`，并剔除「忽略参数」里的动态参数 | 接口带 `_t`、`timestamp`、`nonce` 这类每次不同的参数 |
| 严格         | `METHOD + 完整 href`                                                    | 参数顺序、动态参数本身就是请求身份的一部分           |

举例，同一接口连调两次：

```
GET /api/list?page=1&_t=1699  →  宽松：GET https://site.com/api/list?page=1
GET /api/list?_t=1700&page=1  →  宽松：同上，命中同一条
GET /api/list?page=2&_t=1701  →  宽松：GET https://site.com/api/list?page=2，新的一条
```

默认忽略的参数：`_t`、`_`、`timestamp`、`ts`、`nonce`、`requestId`、`reqTime`，可在设置里改。

命中同一条时的合并行为：

- **非空字段才覆盖**：webRequest 先到达时没有 body，不会把 hook 后到达的 body 冲掉。
- `hitCount` 累加，`firstSeenAt` 保留首次时间，`lastSeenAt` 取最新。
- 记录会移动到列表顶部（按最近一次出现排序）。

## 配置项

设置入口在弹窗右上角的齿轮图标。

| 字段                  | 默认值                                            | 说明                                                                    |
| --------------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| `sites`               | `[]`                                              | 目标站点，输入域名即可匹配其子域名；`www.a.com` 与 `a.com` 互相兼容一层 |
| `methods`             | `GET/POST/PUT/PATCH/DELETE`                       | 需要记录的请求方法                                                      |
| `dedupeMode`          | `loose`                                           | `loose` 宽松 / `strict` 严格                                            |
| `ignoreParams`        | `_t, _, timestamp, ts, nonce, requestId, reqTime` | 仅宽松模式下生效的动态参数                                              |
| `captureRequestBody`  | `true`                                            | 是否记录请求体                                                          |
| `captureResponseBody` | `true`                                            | 是否保存 hook 捕获到的响应体（关闭后仍会经过 hook，但不写入记录）       |
| `includeStatic`       | `false`                                           | 是否同时记录 js/css/图片/字体等静态资源                                 |
| `paused`              | `false`                                           | 全局暂停记录                                                            |
| `maxBodyChars`        | `100000`                                          | 单个 body 最大保存字符数，超出截断并标注原长度                          |

## 记录范围

- 默认只记录 **`xmlhttprequest`、`ping`、`webbundle`、`other`** 四类资源。
- 跳过 `main_frame`（页面本身）和 `csp_report`。
- `script`、`stylesheet`、`image`、`font`、`media`、`object`、`sub_frame` 需在设置里打开「包含静态资源」。
- 响应体只保存文本类内容（JSON、JS、XML、text、graphql、表单），**SSE 与二进制不保存**；请求体遇到二进制会替换为 `[二进制数据 N 字节]`。

## 存储与容量

- 数据存在 `chrome.storage.local`（申请了 `unlimitedStorage`）。
- **单站点最多 300 条**，超出后丢弃最旧的记录。
- 单个请求体 / 响应体截断到 `maxBodyChars`（默认 10 万字符）。
- 清空按钮（顶栏垃圾桶）按当前站点筛选决定范围：筛选了具体站点就只清该站点。

## 目录结构

```
chrome-pulg/
├── public/
│   └── manifest.json          # MV3 声明，构建时原样复制到 dist
├── scripts/
│   ├── build-extension.mjs    # 用 esbuild 把 background / 两个 content script 打成 IIFE
│   └── check.ts               # 纯逻辑断言（站点匹配、去重、覆盖、计数），不依赖浏览器
├── src/
│   ├── background/index.ts    # Service Worker：webRequest 采集、合并入库、消息路由
│   ├── content/
│   │   ├── inject.ts          # MAIN world：hook fetch / XHR，上报请求体与响应体
│   │   └── bridge.ts          # 隔离世界：站点过滤、截断、批量转发给后台
│   ├── shared/
│   │   ├── types.ts           # RecorderConfig / CapturedRequest 等类型
│   │   ├── config.ts          # 默认配置、站点归一化与匹配、去重键计算
│   │   └── merge.ts           # 纯函数：构造记录、合并覆盖、次数统计
│   └── popup/                 # React 弹窗
│       ├── App.tsx            # 列表、筛选、搜索、导出
│       ├── components/        # 详情抽屉、设置面板、代码块
│       ├── utils.ts           # 格式化与展示辅助
│       └── styles.css
├── vite.config.ts             # 只负责构建 popup
└── tsconfig.json
```

## 开发脚本

| 命令                  | 作用                                                                      |
| --------------------- | ------------------------------------------------------------------------- |
| `npm run dev`         | 先完整构建一次，然后并行 watch：Vite 构建 popup、esbuild 构建扩展脚本     |
| `npm run build`       | 清空 `dist` 并完整构建（popup + background + content scripts + manifest） |
| `npm run build:popup` | 只构建 popup                                                              |
| `npm run build:ext`   | 只构建 background 与 content scripts                                      |
| `npm run typecheck`   | TypeScript 类型检查（`tsc --noEmit`）                                     |
| `npm run check`       | 运行去重 / 站点匹配等纯逻辑断言，输出「全部断言通过 ✅」                  |
| `npm run clean`       | 删除 `dist`                                                               |

MV3 没有 HMR，`dev` 只是免去手动重跑构建；改完仍然按上面「使用」里的表格让改动生效。

## 已知限制

- 只 hook 了 `fetch` 和 `XMLHttpRequest`，通过 `WebSocket`、`EventSource`、`sendBeacon`、`<img>` 等方式发出的请求拿不到响应体（仍可能有 webRequest 的元数据）。
- 内容脚本只注入主框架（`all_frames: false`），iframe 内部的请求能通过 webRequest 拿到元数据，但拿不到请求体 / 响应体。
- 响应体读取受内容类型限制：SSE 会一直挂起所以跳过，二进制不保存。
- 单站点 300 条上限，超出后最旧的记录会被丢弃。
- 去重键基于 URL：同一 URL 但语义不同（例如靠请求体区分的 GraphQL 查询）在宽松模式下会被合并成一条，需要时请切到严格模式。
- 页面用 `Service Worker` 拦截、或请求发生在扩展安装之前（未注入 hook 的页面）时，只能拿到 webRequest 的元数据。

## 隐私

插件会把捕获的 URL、查询参数、请求体、响应体、请求头与响应头保存在**本机** `chrome.storage.local`，不会上传到任何服务器。

需要注意这些内容可能包含敏感信息（例如 `Authorization` 请求头、业务数据、用户标识），导出 JSON 或分享截图前请自行确认。点击顶栏垃圾桶可以随时清空记录。
