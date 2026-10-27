---
name: workflow-task
description: >
  用户提供完整 WorkflowConfig（含 workflow + instruction + outputSchema）时使用：
  先用 mcp__crawl__run_crawl 抓取并落盘到 crawl/<YYYYMMDD-HHmmss_短id>/，再按 instruction 处理数据，
  最后严格按 outputSchema 输出 JSON。当用户粘贴/给出带 instruction、outputSchema
  的 workflow 配置，或要求「按配置抓取并按格式输出」时调用本 Skill。
---

# Workflow Task（配置驱动：抓取 → 处理 → 定稿 JSON）

用户给出一份 **WorkflowConfig**。其中：

| 字段 | 谁用 | 含义 |
|------|------|------|
| `workflow` / `maxRetry` | Chrome 扩展 | 如何抓取 |
| `instruction` | 你（Agent） | 对抓到的数据做什么处理 |
| `outputSchema` | 你（Agent） | 最终 JSON 长什么样 |

扩展**只执行** `workflow`；`instruction` / `outputSchema` 原样随 config 落盘到同次任务目录的 `config.json`，供你读取。

抓取细节（步骤类型、听包、`call_api` 等）见 [crawl-analyze/reference.md](../crawl-analyze/reference.md)。本 Skill 负责**整单闭环**，不要改成多轮试探（那是 `crawl-analyze`）。

## 流程（必须按序）

1. **校验配置**  
   - 必须有非空 `workflow`  
   - 必须有 `instruction`（自然语言）  
   - 必须有 `outputSchema`（JSON Schema **或** 示例 JSON 对象）  
   - 缺任一字段：向用户确认后再跑，勿臆造格式

2. **抓取**  
   - 调用 `mcp__crawl__run_crawl`，`config` 传**完整对象**（含 `instruction` / `outputSchema`）  
   - `writePath` 用 `result.json`（定稿，不要 probe slim）  
   - **若返回失败**（`ok: false` 或落盘 `error` 有值）：**立即停止**，只向用户返回失败原因（`error`，必要时附 `progressTail` / `taskId`）。**不要**再读盘做 `instruction` 处理，**不要**按 `outputSchema` 拼业务 JSON，**不要**写 `output.json`

3. **读盘**（仅抓取成功时）  
   - `Read` 工具返回的 `writePath`（形如 `crawl/20260804-105123_a1b2c3d4/result.json`）  
   - 需要时再读同目录 `config.json`（核对 `instruction` / `outputSchema`）  
   - 数据在 `data.collected` / `data.variables`

4. **处理**（仅抓取成功时）  
   - **只按** `instruction` 做聚合、筛选、摘要、字段映射等  
   - 不要引入 instruction 未要求的业务假设  
   - 字段缺失：在输出里按 `outputSchema` 用空值表达，并保持结构合法  
   - 数据量大或需要精确计算（求和、去重、排序、分组）时，用 `mcp__python__run_python` 写脚本读 `result.json` 处理，不要靠心算；不要用 Bash / PowerShell

5. **输出**（仅抓取成功时）  
   - 最终结果必须是**合法 JSON**，结构对齐 `outputSchema`  
   - 若 `outputSchema` 是示例对象：键名与层级对齐示例；未知值用 `null` / `[]` / `""`  
   - 若是 JSON Schema：满足 required / type  
   - 用 `Write` 写入**与 result 同目录**的 `output.json`（路径取 `writePath` 的目录）  
   - 对用户回复以该 JSON 为主（可附一句落盘路径）；不要用长篇 Markdown 报告替代 JSON

## 配置骨架

```json
{
  "maxRetry": 1,
  "instruction": "从采集结果中提取今日订单：统计笔数、金额合计，并列出前 10 条摘要",
  "outputSchema": {
    "date": "YYYY-MM-DD",
    "totalCount": 0,
    "totalAmount": 0,
    "orders": [{ "id": "", "amount": 0, "status": "" }]
  },
  "workflow": [
    {
      "type": "navigate",
      "url": "https://ebooking.ctrip.com/ebkorderv3/domestic?microJump=true#tab=4",
      "event": "orders",
      "need_collect": true,
      "reg_exp": "/restapi/soa2/27204/queryOrderList"
    }
  ]
}
```

完整示例见 [examples/orders-summary.json](examples/orders-summary.json)。

## 约束

- 优先本 Skill；不要绕开配置去 Bash/curl，也不要扒前端 JS。  
- **抓取失败 → 只回报原因并结束**；成功才走 instruction / outputSchema。  
- 不要擅自改用户的 `workflow` 步骤（除非用户要求修好再跑）。  
- `instruction` / `outputSchema` 不得传给扩展当步骤字段；它们只在顶层。  
- **逐条生成回复**用 workflow 里的 `call_bot`（bot_code + content），写在 loop 中、提交商家接口之前。不要把「边看边回」做成多轮 Skill。`instruction` 只负责整单结束后的 outputSchema。  
- `call_backend` 把明细交给我们后端保存；Agent 回传的 outputSchema 仍是汇总信封，不要替代逐条入库。  
- 成功时最终交付 = `outputSchema` 形状的 JSON + 工作区同次任务目录下的 `output.json`。  
- 读写路径始终相对 **workspace**，绝不相对本 Skill 目录。
