# WorkflowConfig 参考

顶层：

```ts
{
  maxRetry?: number;          // 整单失败重试次数，默认按引擎约 3
  workflow: WorkflowItem[];   // 必填，顺序执行（扩展执行）
  instruction?: string;       // Agent 侧：对抓取结果如何处理（扩展忽略）
  outputSchema?: unknown;     // Agent 侧：最终 JSON 形态 / Schema（扩展忽略）
}
```

若配置含 `instruction` + `outputSchema`，应走 Skill **`workflow-task`**：抓取 → 按 instruction 处理 → 按 outputSchema 输出 JSON。本文件只描述扩展可执行的抓取步骤。

结果形态（`await_crawl` 落盘后的 `data`）：

```json
{
  "collected": {
    "<event名>": {
      "type": "array",
      "content": [
        {
          "url": "...",
          "method": "GET",
          "payload": {},
          "response": {},
          "headers": {},
          "cookies": {}
        }
      ]
    }
  },
  "variables": { "<变量名>": "..." }
}
```

- `text` 采集：`collected.<event>` = `{ "type": "text", "value": "..." }`
- `dom_snapshot` 采集：`collected.<event>` = `{ "type": "dom_snapshot", "value": { url, title, elements, … } }`

---

## 步骤类型

| type | 作用 | 硬性前置 |
|------|------|----------|
| `navigate` | 打开/跳转 URL，注入监听 | 需要 `url` |
| `call_api` | 在**当前页**上下文发 fetch（带 cookie） | 须先 `navigate`；用 `call_api_params` |
| `call_bot` | 调我们 bot 接口生成文案（bot_code + content） | 不走商家页；结果写入 `_botResult` |
| `call_backend` | 调我们后端统一入口，用 `type` 区分保存逻辑 | 不走商家页；`call_backend_params.type` + `payload` |
| `dom_snapshot` | 扫描关键 DOM，生成可用 CSS `selector` 列表 | 须先 `navigate`；建议 `need_collect` + `event` |
| `click` | 点击元素 | 须先 `navigate`；要 `selector` |
| `input` | 输入框填值 | 须先 `navigate`；要 `selector` + `value` |
| `text` | 读取元素文本 | 须先 `navigate`；要 `selector`；采集要 `need_collect` |
| `check` | 勾选 checkbox | 须先 `navigate`；要 `selector` |
| `loop` | 循环执行 `children` | 要 `children` + `max_count` |

不支持上表以外的 `type`。

---

## 通用字段

| 字段 | 说明 |
|------|------|
| `type` | 步骤类型（必填） |
| `event` | 采集桶名 / 进度日志名。`need_collect: true` 时**强烈建议**设置；结束后引擎会检查 `collected[event]` 是否存在，没有则整步失败 |
| `need_collect` | `true` 时本步必须采到数据（网络命中或 text 写入） |
| `reg_exp` | 网络 URL 匹配（`urlMatch`）：逗号分隔为 **OR** 多规则，`*` 通配。监听命中与写入 `collected` 使用同一套规则。正式采集写稳定路径片段；探测可用 `"."` |
| `global_variables` | 对象或数组。`{ name, url }`：URL 命中时把该请求的 req/res/headers/cookies 写入 `variables[name]`；`{ name, value }`：直接/表达式赋值 |
| `outputs` | 步骤结束时写变量。`{ name, value }`，`value` 可为 `${expr}` |
| `allow_exception` | `true` 时本步失败不抛死，继续 |
| `pass_condition` | 步骤末表达式，须为真，如 `"${someVar != null}"` |
| `wait_before_finish` | 步骤收尾额外等待（毫秒） |
| `close_tab_before_finish` | 按 URL 片段关闭窗口内其它标签 |
| `query_element_timeout` | DOM 等待超时毫秒，默认 20000 |

默认等待（大致）：`need_collect` 的 navigate≈15s、DOM 步≈10s、call_api≈5s；否则≈3s。可再加 `wait_before_finish`。

---

## 表达式 `${...}`

- 整段：`"${foo.bar}"`、`"${list.content.length > 0}"`
- 字符串插值：`"https://x.com/item/${id}"`
- 用在：`url`、`value`、`event`、`outputs`、`pass_condition`、`break_condition`、`max_count`、`call_api_params` 内字段等
- `global_variables` / 网络命中后，变量里常见结构：

```js
variables.apiFoo = {
  url, method, headers, queryParams, payload, response, cookies
}
```

取响应字段示例：`"${apiFoo.response.data.list}"`（路径按真实 JSON 调整）。

### `__ref`（对象展开合并）

在 **`getDeepValue` 会处理的对象树**里（主要是 `call_api_params` 的 `payload` / `headers` / `query_params`），特殊键 `__ref` 表示：先求值，再把结果**展开合并**进当前对象（自身键名为 `__ref`，不会留在最终对象里）。

规则（见 `eval.ts` → `getDeepValue`）：

1. `__ref` 的值先走 `getDeepValue`（可为 `"${varName}"` 或嵌套对象）
2. 若结果是**普通对象**（非数组），`{ ...当前已解析字段, ...ref对象 }`
3. 若结果不是对象（或是数组）→ **忽略**，不合并
4. 同级其它键照常递归；后写的同名键会覆盖先合并进来的字段
5. 可与字面量字段混用：用 `__ref` 铺底，再用显式字段覆盖

典型用途：把上一步 `global_variables` 抓到的整段 `payload`/`headers` 复用到 `call_api`，只改分页等字段。

```json
{
  "type": "call_api",
  "event": "orders_next",
  "need_collect": true,
  "reg_exp": "/api/orders",
  "global_variables": { "name": "ordersHit", "url": "/api/orders" },
  "call_api_params": {
    "url": "https://example.com/api/orders",
    "method": "POST",
    "headers": {
      "__ref": "${ordersHit.headers}",
      "Content-Type": "application/json"
    },
    "payload": {
      "__ref": "${ordersHit.payload}",
      "page": "${_loopIndex}",
      "size": 20
    }
  }
}
```

注意：

- `__ref` **不是**步骤级字段；写在 `navigate`/`click` 根上无效。
- `url` 字符串本身用 `${}` 插值即可，一般不用 `__ref`。
- 合并的是「对象字段」；若 `"${ordersHit.payload}"` 实际是数组/字符串，不会展开。
- 处理顺序按 `Object.keys` 遍历：建议把 `__ref` 写在前面作底，后面的键覆盖。

---

## navigate

```json
{
  "type": "navigate",
  "url": "https://example.com/page",
  "event": "page_apis",
  "need_collect": true,
  "reg_exp": "/api/list,/api/detail"
}
```

- 首步几乎总是 `navigate`（建立采集窗口与标签）。
- 页面打开后自动触发的 XHR/fetch，靠 `need_collect` + `reg_exp`（和/或 `global_variables[].url`）捕获。
- 只要监听、不强制采满：可 `need_collect: false`，但仍建议设 `reg_exp` / `global_variables` 以便命中写入。
- `need_collect: true` 且设置了 `event`：等待期内**必须**至少命中一次并写入 `collected[event]`，否则报「没有采集到需要采集的数据」。

### 探测：宽 `reg_exp`（不扩展引擎）

不知道接口路径时，**不要**改引擎字段；用现有 `need_collect` + 宽规则即可：

```json
{
  "type": "navigate",
  "url": "https://example.com/page",
  "event": "probe",
  "need_collect": true,
  "reg_exp": "."
}
```

- `"."` 会命中绝大多数 URL（仍走原有 `updateData`）。
- Agent 侧：结果写入 `crawl/<YYYYMMDD-HHmmss_短id>/`（时间前缀，目录名排序≈新旧）；`writePath` 为文件名（如 `probe.json` / `result.json`）。文件名含 `probe` 时落盘瘦身；JSON 内仍有完整 `taskId`。
- 定稿轮：精确 `reg_exp`，`writePath: "result.json"`，`slim: false`。
- 示例：`examples/probe-workflow.json`。

---

## call_api（二次请求首选）

在已 `navigate` 的标签里用页面上下文 `fetch`（带 cookie）。翻页、改查询参数、再拉数据时**优先用 call_api**，不要 Bash/`curl`，不要先扒前端 JS。

同一步须配 `need_collect` + `reg_exp`（和/或 `global_variables`）。常见组合：navigate 听一跳 → `global_variables` → call_api + `__ref` 改字段：

```json
{
  "type": "call_api",
  "event": "list_api",
  "need_collect": true,
  "reg_exp": "/api/list",
  "call_api_params": {
    "url": "https://example.com/api/list",
    "method": "POST",
    "headers": {
      "__ref": "${listHit.headers}",
      "Content-Type": "application/json"
    },
    "payload": {
      "__ref": "${listHit.payload}",
      "page": 2
    }
  }
}
```

`call_api_params` 可为数组。URL/字段以探测落盘为准。完整示例：`examples/call-api-workflow.json`。

---

## call_bot（循环里逐条生成，边看边回）

走**我们自己的** `/agent/conversations/create` + `/agent/chat/completions`（和现网 `llmRequest` 同一套），不是商家接口，也不是任务结束后的 Agent `instruction`。

只要 `bot_code` + `content`。`content` 可以是字符串或对象（对象会 `JSON.stringify`）。可选 `hotel_code`、`payload`。生成结果写入 `variables._botResult` 和 `variables[event]`，下一步 `call_api` 用 `"${_botResult}"` 当回复正文。

```json
{
  "type": "call_bot",
  "event": "gen_reply",
  "call_bot_params": {
    "bot_code": "CTRIP_REPLY",
    "hotel_code": "${hotelCode}",
    "content": {
      "comment": "${listHit.response.commentlist[_i].content}",
      "score": "${listHit.response.commentlist[_i].avgScore}"
    }
  }
}
```

凭证：`chrome.storage.local.ourBackend = { baseUrl, accessToken, hotelCode }`，由客户端登录后写入。未配置会失败。

---

## call_backend（结果交给我们后端保存）

扩展不写死「评论入库」字段。POST `{ type, payload }` 到 `/client/task/ingest`，后端按 `type` 分发。

```json
{
  "type": "call_backend",
  "event": "save_comment",
  "call_backend_params": {
    "type": "ctrip_comment_save",
    "payload": {
      "hotel_code": "${hotelCode}",
      "comment_id": "${listHit.response.commentlist[_i].commentId}",
      "detail": "${detailHit.response}"
    }
  }
}
```

---

## 写接口入参从哪来（不要扒 JS）

读接口：页面自加载或 `call_api` 即可拿到。  
写接口（提交/保存）若从未被听包捕获过：

1. 用 `click`/`input` **真实走通一次 UI 提交**
2. 在提交那一步 `need_collect` + `reg_exp`（业务 API 路径片段）+ `global_variables`
3. 落盘里的 `payload`/`headers` 即真实传参
4. 再 `call_api` + `__ref` 复用；若有前端签名导致 call_api 失败，则对每条重复 UI 提交

禁止用 `reg_exp` 去匹配 `.js`/`.css`/`chunk` 当「读源码」。示例：`examples/ui-capture-write-api.json`。

---

## DOM：dom_snapshot（先拿 selector）

**不知道要点哪个元素时**，先跑 `dom_snapshot`，再根据落盘结果写 `click`/`input`。

```json
{
  "type": "dom_snapshot",
  "event": "ui_map",
  "need_collect": true,
  "max_count": 80
}
```

可选字段：

| 字段 | 说明 |
|------|------|
| `selector` | 要扫描的元素查询（逗号多规则）。省略则默认：按钮/链接/输入/带 `he-click`/`data-testid` 等 + `h1`–`h3`/`label` |
| `max_count` | 最多返回条数，默认 60，上限 200（优先可见/可点/有文案） |

落盘 `value` 形态：

```json
{
  "url": "https://…",
  "title": "页面标题",
  "count": 12,
  "truncated": false,
  "elements": [
    {
      "selector": "[he-click=\"reply_edit\"]",
      "tag": "button",
      "text": "回复",
      "attrs": { "he-click": "reply_edit" },
      "visible": true,
      "clickable": true
    }
  ]
}
```

用法：读 `elements[].text` / `attrs` 选目标 → 把对应 `selector` 填进下一轮 `click`/`input`。示例：`examples/dom-snapshot-then-click.json`。

---

## DOM：click / input / text / check

`click`/`input`：切换模块，或**触发一次写接口以便听包**；读列表/翻页优先 `call_api`。selector 未知时先 `dom_snapshot`。

```json
{ "type": "click", "selector": "button.submit, .btn-ok", "event": "click_submit" }
```

```json
{
  "type": "input",
  "selector": "input[name='q']",
  "value": "关键词",
  "event": "fill_q"
}
```

```json
{
  "type": "text",
  "selector": "h1.title",
  "event": "page_title",
  "need_collect": true
}
```

```json
{ "type": "check", "selector": "input[type=checkbox].agree" }
```

- `selector` 支持逗号多选，命中第一个存在的。
- `text` + `need_collect` → `collected[event]` 为 `{ type: "text", value }`
- `dom_snapshot` + `need_collect` → `collected[event]` 为 `{ type: "dom_snapshot", value }`
- click/input 本身不写入 collected，除非另有网络监听或 `outputs`。

---

## loop

```json
{
  "type": "loop",
  "max_count": 5,
  "loop_index_var": "_loopIndex",
  "break_condition": "${list_api.content.length >= 3}",
  "children": [
    {
      "type": "call_api",
      "event": "list_api",
      "need_collect": true,
      "reg_exp": "/api/orders",
      "call_api_params": {
        "url": "https://example.com/api/orders",
        "method": "GET",
        "query_params": { "page": "${_loopIndex}" }
      }
    }
  ]
}
```

- `max_count` 可为数字或 `"${expr}"`。
- 每次循环先设 `variables[loop_index_var] = i`（默认 `_loopIndex`，从 0）。
- `break_condition` 为真则提前结束。

---

## 选型决策

1. **未知接口** → `navigate` + `reg_exp: "."` 探测
2. **页面自加载接口** → `navigate` + 精确 `reg_exp` + `event`（可加 `global_variables`）
3. **再请求 / 改参 / 翻页** → **`call_api`（优先）**，常用 `__ref`
4. **要操作 UI 但 selector 未知** → `dom_snapshot` → 再 `click`/`input`
5. **必须点 Tab/模块才出包** → `click`（在 click 步听包），然后再 `call_api` 如需要
6. **只要 DOM 文案** → `text` + `need_collect`；或 `dom_snapshot` 看一批
7. **多次翻页** → `loop` 包 `call_api`（优先于 loop 点按钮）
8. **逐条生成回复** → navigate 先采列表接口模板 → 外层 loop `call_api` 翻页 → 内层 `call_bot` → `call_api` 提交 → 可选 `call_backend` 入库；不要等整单结束再靠 Agent instruction 写回复

网络监听绑定**当前步骤**；click 后才发的 XHR，规则写在 click 步上。

---

## 常见失败

| 报错/现象 | 原因与改法 |
|-----------|------------|
| 扩展未连接 | 先连 bridge，勿编造数据 |
| workflow 为空 | 必须有非空 `workflow` |
| 没有采集到需要采集的数据: X | `collected[event]` 未写入。若日志已有「网络命中」仍失败，检查 `reg_exp` 是否误写成需整段匹配的形式；逗号多规则为 OR。或加长等待 |
| call_api / click 前需要先 navigate | 步骤顺序错误 |
| selector 元素不存在 | 选择器不对或需登录；可 `allow_exception` 或先确认页面 |
| pass_condition 未通过 | 检查变量是否已写入 |
| 不支持的步骤类型 | 拼写错误 |

登录态：扩展使用用户 Chrome 里已登录的 cookie；未登录站点会采到登录页或空数据，应在报告中说明，不要假装成功。
