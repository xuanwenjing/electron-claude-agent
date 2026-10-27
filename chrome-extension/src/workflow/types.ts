export type WorkflowStepType =
  | "navigate"
  | "call_api"
  | "call_bot"
  | "call_backend"
  | "click"
  | "text"
  | "input"
  | "check"
  | "dom_snapshot"
  | "loop";

export interface WorkflowOutput {
  name: string;
  value?: unknown;
}

export interface GlobalVariable {
  name: string;
  url?: string;
  value?: unknown;
}

export interface CallApiParam {
  url: string;
  method?: string;
  headers?: Record<string, unknown>;
  payload?: unknown;
  query_params?: Record<string, unknown>;
  mode?: string;
}

/** 调我们自己的 bot（/agent/conversations/create + /agent/chat/completions） */
export interface CallBotParam {
  bot_code: string;
  content: unknown;
  hotel_code?: string;
  payload?: Record<string, unknown>;
}

/**
 * 调我们后端的统一入口。后端用 type 区分任务（评论入库、报表等），
 * 用 payload 做保存。不要把平台 API 写在这里——那是 call_api。
 */
export interface CallBackendParam {
  type: string;
  payload?: unknown;
}

export interface WorkflowItem {
  type: WorkflowStepType | string;
  name?: string;
  url?: string;
  selector?: string;
  value?: unknown;
  event?: string;
  need_collect?: boolean;
  reg_exp?: string;
  outputs?: WorkflowOutput | WorkflowOutput[];
  global_variables?: GlobalVariable | GlobalVariable[];
  call_api_params?: CallApiParam | CallApiParam[];
  call_bot_params?: CallBotParam;
  call_backend_params?: CallBackendParam;
  allow_exception?: boolean;
  pass_condition?: string;
  wait?: number | string;
  wait_before_finish?: number | string;
  close_tab_before_finish?: string;
  children?: WorkflowItem[];
  list?: unknown;
  max_count?: number | string;
  break_condition?: string;
  loop_index_var?: string;
  recycle_count?: number;
  query_element_timeout?: number;
}

export interface WorkflowConfig {
  maxRetry?: number;
  workflow?: WorkflowItem[];
  /**
   * Agent 侧字段（扩展忽略）：描述对抓取结果如何处理。
   * 见 skills/workflow-task。
   */
  instruction?: string;
  /**
   * Agent 侧字段（扩展忽略）：最终 JSON 输出形态（JSON Schema 或示例对象）。
   * 见 skills/workflow-task。
   */
  outputSchema?: unknown;
}

export interface CollectedText {
  type: "text";
  value: unknown;
}

export interface CollectedDomSnapshot {
  type: "dom_snapshot";
  value: unknown;
}

export interface CollectedArray {
  type: "array";
  content: unknown[];
}

export type CollectedEntry = CollectedText | CollectedDomSnapshot | CollectedArray;

export interface Collector {
  data: Record<string, CollectedEntry>;
  variables: Record<string, unknown>;
}

export type EmitFn = (message: string) => void;

export interface WorkflowResult {
  ok: boolean;
  data: { collected: Collector["data"]; variables: Collector["variables"] } | null;
  error?: string | null;
}

export interface PageFetchResult {
  ok: boolean;
  body: unknown;
  headers: Record<string, string>;
  status: number;
  statusText: string;
}

export interface XhrCapturePayload {
  api: string;
  method?: string;
  body?: unknown;
  response?: unknown;
  headers?: Record<string, string>;
  responseURL?: string;
  cookie?: string;
}

export interface NetworkUpdatePayload {
  requestData?: unknown;
  responseData?: unknown;
  api: string;
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}
