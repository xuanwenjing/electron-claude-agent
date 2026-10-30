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
