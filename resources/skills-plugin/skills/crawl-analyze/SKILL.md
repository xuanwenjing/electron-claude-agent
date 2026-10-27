---
name: crawl-analyze
description: 通过 Chrome 扩展试配/调试 WorkflowConfig（听包、call_api、dom_snapshot）。当用户要求抓取调试、探测接口、改 workflow 步骤，或提到 run_crawl / call_api 且配置不含 instruction+outputSchema 时使用。若用户给出含 instruction 与 outputSchema 的完整配置，改用 workflow-task。禁止扒 JS。
---

# Crawl Analyze（抓取并分析）

用 **`mcp__crawl__run_crawl` + WorkflowConfig** **试配**抓取步骤。细节见 [reference.md](reference.md)。

用户已给出带 **`instruction` + `outputSchema`** 的完整配置 → 改用 Skill **`workflow-task`**（抓取后按格式输出 JSON）。

## 能力组合

1. **navigate + 听包**（`need_collect` + `reg_exp`，必要时 `global_variables`）
2. **call_api**（宿主页再请求：列表筛选、翻页、复用已捕获的写接口）
3. **call_bot**（我们 bot 接口，bot_code + content；写在 loop 里即可边看边回）
4. **call_backend**（我们后端 `/client/task/ingest`，用 type 区分保存）
5. **dom_snapshot**（先拿页面关键元素与可用 `selector`，再 click/input）
6. **click / input**（打开模块、填表、**触发一次真实提交以便听包**）

不要默认 Bash / curl / 下载前端 JS。

## 方法优先级

1. `navigate` 听包（未知接口用 `reg_exp: "."`）
2. 读接口再请求 → **`call_api` + `__ref`**（复用已捕获 payload/headers）
3. **需要点 UI 但不知道 selector** → 先 `dom_snapshot`（`need_collect`），从落盘 `elements[].selector` / `text` 选目标，下一轮再 `click`/`input`
4. **写接口入参未知**（如提交类 API）→ **不要扒 JS**；用一次 UI 流程听包（见下节）
5. 已有写接口样本 → `call_api` + `__ref` 改字段批量调用；或继续 UI 循环
6. 数据够了 → 写报告

`call_api` = 宿主页 `pageFetch`（带 cookie）。

## 写接口：用「一次真实提交」拿传参（替代扒 JS）

要调尚未出现过的写接口、又不知道 body 字段时：

1. `navigate` 打开业务页  
2. **selector 未知时**：先一步 `dom_snapshot`，从结果选按钮/输入框 selector  
3. `click` / `input` 走通**一次**最小 UI（打开编辑框 → 填内容 → 点提交）  
4. **在会发出该请求的那一步**上配：`need_collect` + `reg_exp`（接口路径片段）+ `global_variables`  
5. 从落盘的 `payload` / `headers` 学习真实传参  
6. 之后用 `call_api` + `__ref` 改 `content` / id 等字段批量做；若请求带前端签名、纯 `call_api` 失败，则对每条继续走 UI 提交并听包校验

示例：`examples/dom-snapshot-then-click.json`、`examples/ui-capture-write-api.json`。

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
- 选择器仅为 CSS；未知时用 `dom_snapshot`，见 reference。  
- 失败如实说明；报告 `notes/crawl-report.md`。
