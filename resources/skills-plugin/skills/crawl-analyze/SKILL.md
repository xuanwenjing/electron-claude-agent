---
name: crawl-analyze
description: 通过 Chrome 扩展试配/调试 WorkflowConfig（听包、call_api、click）。当用户要求抓取调试、探测接口、改 workflow 步骤，或提到 run_crawl / call_api 时使用。禁止扒 JS。
---

# Crawl Analyze（抓取并分析）

用 **`mcp__crawl__run_crawl` + WorkflowConfig** **试配**抓取步骤。细节见 [reference.md](reference.md)。

## 能力组合

1. **navigate + 听包**（`need_collect` + `reg_exp`，必要时 `global_variables`）
2. **call_api**（宿主页再请求：列表筛选、翻页、复用已捕获的写接口）
3. **call_backend**（调我们后端接口：`url` + `method` / `data` / `params` / `headers`）
4. **click**（打开模块、**触发一次真实提交以便听包**）

不要默认 Bash / curl / 下载前端 JS。

## 方法优先级

1. `navigate` 听包（未知接口用 `reg_exp: "."`）
2. 读接口再请求 → **`call_api` + `__ref`**（复用已捕获 payload/headers）
3. **写接口入参未知**（如提交类 API）→ **不要扒 JS**；用一次 UI 流程听包（见下节）
4. 已有写接口样本 → `call_api` + `__ref` 改字段批量调用；或继续 UI 循环
5. 数据够了 → 写报告

`call_api` = 宿主页 `pageFetch`（带 cookie）。

## 写接口：用「一次真实提交」拿传参（替代扒 JS）

要调尚未出现过的写接口、又不知道 body 字段时：

1. `navigate` 打开业务页  
2. `click` 走通**一次**最小 UI（打开编辑框 → 点提交）  
3. **在会发出该请求的那一步**上配：`need_collect` + `reg_exp`（接口路径片段）+ `global_variables`  
4. 从落盘的 `payload` / `headers` 学习真实传参  
5. 之后用 `call_api` + `__ref` 改 `content` / id 等字段批量做；若请求带前端签名、纯 `call_api` 失败，则对每条继续走 UI 提交并听包校验

示例：`examples/ui-capture-write-api.json`。

`reg_exp` **禁止**去匹配 `.js` / `.css` / `chunk`——那是静态资源，不是业务传参来源。

## 工具

| 工具 | 用途 |
|------|------|
| `run_crawl` | 主路径 |
| `start_crawl` / `await_crawl` | 分步 |
| `cancel_crawl` / `list_crawl_results` | 取消 / 历史 |

落盘在**工作区** `crawl/<YYYYMMDD-HHmmss_短id>/`（相对 workspace，勿拼到 Skill 目录）；MCP 的 `writePath` 参数用文件名（`probe.json` / `result.json`），读盘用返回的 `writePath`/`absPath`。

## 约束

- 最多 5 轮 `run_crawl`；只改 WorkflowConfig。  
- `config` 传对象；以 `navigate` 开头；`need_collect` 必配 `event`。  
- 选择器仅为 CSS，见 reference。  
- 失败如实说明；报告 `notes/crawl-report.md`。
