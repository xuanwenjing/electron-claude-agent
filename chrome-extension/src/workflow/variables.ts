/**
 * 工作流变量（collector.variables）的唯一写入入口。
 *
 * 用户配置的变量来源只有四种，每步执行顺序固定：
 *   1. capture  —— 本步网络请求命中时写入（navigate / click / call_api）
 *   2. save_as  —— 本步返回值（call_backend 返回体、run_agent 模型输出）
 *   3. set      —— 本步结束后求值赋值
 *   4. append   —— 本步结束后追加到数组（跨轮累积）
 * 另有 loop 的 item_var / index_var（只在循环内有效）和引擎内置变量（以 _ 开头，如 _hotelInfo）。
 */
import type { Collector, EmitFn, NetworkUpdatePayload, WorkflowItem } from "./types";
import { getDeepValue, urlMatch } from "./util";

const VAR_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/** 网络命中写入的结构，表达式里用 ${name.response.xxx} 取值 */
export interface CapturedRequest {
  url: string;
  method?: string;
  headers: Record<string, string>;
  queryParams: Record<string, string>;
  payload: unknown;
  response: unknown;
  cookies: Record<string, string>;
}

/** 用户起的变量名：字母开头，只含字母数字下划线；_ 开头留给引擎内置变量 */
export function assertVarName(name: unknown, field: string): string {
  if (typeof name !== "string" || !VAR_NAME_RE.test(name)) {
    throw new Error(
      `${field} 变量名不合法: ${JSON.stringify(name)}（须字母开头，只含字母、数字、下划线；_ 开头为内置变量保留）`,
    );
  }
  return name;
}

function loopNote(collector: Collector): string {
  return collector.loopPath.length ? `（loop ${collector.loopPath.join(".")}）` : "";
}

function preview(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text == null) return String(value);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

export function setVariable(
  collector: Collector,
  name: string,
  value: unknown,
  emit?: EmitFn,
  source = "",
): void {
  collector.variables[name] = value;
  emit?.(`变量 ${name} ← ${source}${loopNote(collector)}: ${preview(value)}`);
}

function appendVariable(collector: Collector, name: string, value: unknown, emit: EmitFn): void {
  const current = collector.variables[name];
  if (current !== undefined && !Array.isArray(current)) {
    throw new Error(`append 目标 ${name} 已存在且不是数组`);
  }
  const list = (current as unknown[] | undefined) ?? [];
  list.push(value);
  collector.variables[name] = list;
  emit(`变量 ${name} 追加第 ${list.length} 项${loopNote(collector)}: ${preview(value)}`);
}

/** 本步要监听的 URL 规则（capture 的值） */
export function captureRules(workflowItem: WorkflowItem): string[] {
  return workflowItem.capture ? Object.values(workflowItem.capture).filter(Boolean) : [];
}

/** 网络命中：写入所有 URL 规则匹配的 capture 变量（多次命中保留最后一次） */
export function captureNetworkHit(
  collector: Collector,
  workflowItem: WorkflowItem,
  payload: NetworkUpdatePayload,
  emit: EmitFn,
): void {
  if (!workflowItem.capture) return;
  for (const [name, rule] of Object.entries(workflowItem.capture)) {
    if (!rule || !urlMatch(payload.api, rule)) continue;
    const queryParams: Record<string, string> = {};
    new URLSearchParams(String(payload.api).split("?")[1] || "").forEach((value, key) => {
      queryParams[key] = value;
    });
    const captured: CapturedRequest = {
      url: payload.api,
      method: payload.method,
      headers: payload.headers || {},
      queryParams,
      payload: payload.requestData || {},
      response: payload.responseData || {},
      cookies: payload.cookies || {},
    };
    setVariable(collector, assertVarName(name, "capture"), captured, emit, `capture ${rule}`);
  }
}

const REMOVED_FIELDS: Record<string, string> = {
  global_variables: "{name,url} 改用 capture，{name,value} 改用 set",
  loop_index_var: "改用 index_var",
};

/** 步骤开始前校验变量配置，配置错误尽早报出 */
export function validateStepVariables(workflowItem: WorkflowItem): void {
  for (const [field, hint] of Object.entries(REMOVED_FIELDS)) {
    if (field in workflowItem) throw new Error(`${field} 已不再支持：${hint}`);
  }
  if (workflowItem.run_agent_params && "save_as" in workflowItem.run_agent_params) {
    throw new Error("run_agent_params.save_as 已不再支持：改为步骤上的 save_as");
  }
  for (const name of Object.keys(workflowItem.capture ?? {})) assertVarName(name, "capture");
  if (workflowItem.save_as !== undefined) assertVarName(workflowItem.save_as, "save_as");
  for (const name of Object.keys(workflowItem.set ?? {})) assertVarName(name, "set");
  for (const name of Object.keys(workflowItem.append ?? {})) assertVarName(name, "append");
}

/** 步骤结束：依次处理 save_as → set → append */
export function applyStepOutputs(
  collector: Collector,
  workflowItem: WorkflowItem,
  result: unknown,
  emit: EmitFn,
): void {
  if (workflowItem.save_as) {
    if (result === undefined) {
      emit(`save_as 忽略：${workflowItem.type} 步骤没有返回值，网络请求请用 capture`);
    } else {
      setVariable(collector, workflowItem.save_as, result, emit, `${workflowItem.type} 返回值`);
    }
  }
  for (const [name, expr] of Object.entries(workflowItem.set ?? {})) {
    setVariable(collector, name, getDeepValue(collector.variables, expr), emit, "set");
  }
  for (const [name, expr] of Object.entries(workflowItem.append ?? {})) {
    appendVariable(collector, name, getDeepValue(collector.variables, expr), emit);
  }
}
