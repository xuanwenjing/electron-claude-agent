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

## 网络采集（need_collect）

`matchApiList = (need_collect && reg_exp) + Object.values(capture)`  
MAIN 拦截 → content → `onXhrResponse`：`captureNetworkHit` 写变量，`collectNetworkHit` 写 `collected`（`{ url, payload, response, method, headers, cookies }`）

## 变量

所有写 `variables` 的逻辑都在 `src/workflow/variables.ts`：`capture`（网络命中）→ `save_as`（步骤返回值）→ `set` → `append`，loop 的 `item_var` / `index_var` 在 `runWorkflow.ts` 的 `runLoop` 里设置并在结束时恢复。

`run_agent` 带 `list` 为批量模式（`src/workflow/agent/runAgent.ts`）：每项用 `{...variables, item_var, index_var}` 渲染 prompt（不改动 variables），最多 `concurrency` 个同时运行，结果按 list 顺序组成数组交给 `save_as`。默认任一项失败整步失败并中止其它项；`allow_exception` 时失败项为 `null`，错误写入 `${save_as}_errors`（`[{index, error}]`）。客户端所有任务合计最多同时运行 4 个 Agent（`workflowAgent.ts` 的 `MAX_AGENT_CONCURRENCY`），超出排队。

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
