# Chrome 扩展（通用抓取）

TypeScript 源码在 `src/`，构建产物在 `dist/`。**Chrome 请加载 `chrome-extension/dist/`**。

## 开发

```bash
npm run ext:build      # 构建一次
npm run ext:watch      # 监听重建
npm run ext:typecheck  # tsc 类型检查
```

改代码后在 `chrome://extensions` **重新加载**扩展。

## 目录

```
chrome-extension/
├── build.mjs
├── tsconfig.json
├── public/                # 原样复制到 dist
├── src/
│   ├── shared/
│   ├── background/        # Service Worker + WS
│   ├── workflow/
│   │   ├── index.ts       # 对外导出
│   │   ├── types.ts
│   │   ├── runWorkflow.ts # 编排入口
│   │   ├── util/          # eval / urlMatch / cancel
│   │   ├── browser/       # tabs + crawlWindow
│   │   ├── api/           # callApi + pageFetch
│   │   ├── ourBackend/    # call_backend
│   │   └── collect/       # collector + networkCapture
│   ├── content/
│   ├── page/
│   └── popup/
└── dist/                  # ← 加载此目录
```

## 窗口 / 标签

- 复用同一采集窗口（`currentCrawlWindow`）
- **首标签不参与采集、不关闭**
- 实现：`src/workflow/browser/crawlWindow.ts`

## 网络捕获（capture）

`capture: { 变量名: URL 规则 }`：本步页面请求命中规则时写入变量 `{ url, method, headers, queryParams, payload, response, cookies }`（多次命中保留最后一次）。MAIN 拦截 → content → `onXhrResponse` → `captureNetworkHit`。

配了 `capture` 的 navigate / click / call_api，动作后等到**所有** capture 变量都在本步命中才结束；超时（`wait`，navigate 默认 15s，其余 10s）本步失败，`allow_exception` 时只记日志。没配 `capture` 时动作后固定等待 `wait`（默认 3s）。任务结果只有 `variables`（不再有 `collected`；`event` / `need_collect` / `reg_exp` 已移除，配了会报错）。

URL 规则（`capture` 的值 / `close_tab_before_finish`，`src/workflow/util/urlMatch.ts`）：`路径正则[?k=v&k2=*]`，逗号分隔多条任一命中。路径是不带锚点的正则，只和 URL 的 `?` 之前比较（`?` 和 `,` 已用作分隔符，正则里不能出现，可选字符写成 `(s|)`）；参数条件全部满足才命中，`k=v` 值相等，`k=*` 或只写 `k` 表示带了该参数。规则不合法在步骤开始前报错。例：`queryGeneralCommentInfo?replyType=1`。

## 变量

所有写 `variables` 的逻辑都在 `src/workflow/variables.ts`：`capture`（网络命中）→ `save_as`（步骤返回值）→ `set` → `append`，loop 的 `item_var` / `index_var` 在 `runWorkflow.ts` 的 `runLoop` 里设置并在结束时恢复。

`run_agent` 带 `list` 为批量模式（`src/workflow/agent/runAgent.ts`）：每项用 `{...variables, item_var, index_var}` 渲染 prompt（不改动 variables），最多 `concurrency` 个同时运行，结果按 list 顺序组成数组交给 `save_as`。默认任一项失败整步失败并中止其它项；`allow_exception` 时失败项为 `null`，错误写入 `${save_as}_errors`（`[{index, error}]`）。客户端所有任务合计最多同时运行 4 个 Agent（`workflowAgent.ts` 的 `MAX_AGENT_CONCURRENCY`），超出排队。

## call_api 平台验签

`call_api_params` 每项可选（`src/workflow/api/callApi.ts`、`platformRequest.ts`，都在宿主页 MAIN world 调用页面全局对象，须先 navigate 到对应平台页面）：

| 配置 | 平台 | 行为 |
|------|------|------|
| 不配 | 通用 | 宿主页 `fetch`，带页面 Cookie |
| `"sign": "mtgsig"` | 美团 | 对最终 URL（含 `query_params`）和 body 调 `window.H5guard.sign`，签名头 `mtgsig` 合并进请求头再 `fetch` |
| `"mode": "mtop"` | 飞猪 | 不走 `fetch`，调 `window.mtopRequest({ api: url, headers, ...payload })`；`payload` 须为对象 |

`call_api` 的返回体可用 `save_as` 取（`call_api_params` 为数组时是数组），`mtop` 请求可能不经 XHR/fetch，取结果用 `save_as` 而不是 `capture`。

```json
{ "type": "call_api", "save_as": "list", "call_api_params": {
  "url": "https://me.meituan.com/api/gw/v1/base/comments/queryGeneralCommentInfo", "method": "GET", "sign": "mtgsig",
  "headers": { "__ref": "${listHit.headers}" }, "query_params": { "__ref": "${listHit.queryParams}", "offset": "${_index * 10}" } } }
```

```json
{ "type": "call_api", "save_as": "replyRes", "call_api_params": {
  "url": "mtop.alitrip.hotel.comment.reply", "mode": "mtop", "payload": { "v": "1.0", "data": { "id": "${_item.id}", "content": "${replies[_index].reply}" } } } }
```

任意步骤（含 loop）可配 `skip_if`：步骤开始前求值，为真则跳过，如 `"${replies[_index] == null}"`。

## 维护

| 改什么 | 动哪里 |
|--------|--------|
| 编排 / 重试 | `src/workflow/runWorkflow.ts` |
| 拦截匹配 / 落库 | `workflow/collect/` |
| XHR/fetch 钩子 | `src/page/networkInterceptor.ts` |
| 主动调接口 | `workflow/api/` |
| 调我们 bot / 后端 | `workflow/ourBackend/` |
| 类型 | `src/workflow/types.ts` |
| 表达式 / `__ref` | `workflow/util/eval.ts`（MV3，无 `new Function`） |
| DOM click | `src/content/dom.ts` |
| 可取消等待 | `workflow/util/cancel.ts` |
