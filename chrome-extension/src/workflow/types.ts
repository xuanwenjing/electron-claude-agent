import { HotelPlatform } from "../../../src/shared/merchant";
export { HotelPlatform } from "../../../src/shared/merchant";
import type { TaskErrorCode } from "../../../src/shared/bridgeProtocol";

export type WorkflowStepType =
  | "navigate"
  | "call_api"
  | "call_backend"
  | "click"
  | "loop"
  | "run_agent";

/** call_api 请求通道 */
export const CallApiMode = {
  /** 默认：宿主页 window.fetch，带页面 Cookie */
  Page: "page",
  /** 飞猪：宿主页 window.mtopRequest（页面自带验签），url 为 mtop api，payload 字段展开为入参 */
  Mtop: "mtop",
} as const;

export type CallApiMode = (typeof CallApiMode)[keyof typeof CallApiMode];

/** call_api 发请求前的签名（仅 page 通道） */
export const CallApiSign = {
  /** 美团：宿主页 window.H5guard.sign 对最终 url / body 签名，签名头（mtgsig）合并进请求头 */
  Mtgsig: "mtgsig",
} as const;

export type CallApiSign = (typeof CallApiSign)[keyof typeof CallApiSign];

export interface CallApiParam {
  url: string;
  method?: string;
  headers?: Record<string, unknown>;
  payload?: unknown;
  query_params?: Record<string, unknown>;
  mode?: CallApiMode;
  sign?: CallApiSign;
}

/**
 * 调我们后端接口（经 shared/request）。不要把平台 API 写在这里——那是 call_api。
 */
export interface CallBackendParam {
  /** 相对 Request baseURL 的路径或完整 URL，支持 ${expr} */
  url: string;
  /** 默认 POST */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** 请求体，支持 ${expr} / __ref */
  data?: unknown;
  /** URL query，支持 ${expr} / __ref */
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  timeout?: number;
}

/** run_agent：由客户端解压 Skill 包并运行大模型，结果用步骤的 save_as 写入变量 */
export interface RunAgentStepParam {
  /** 用户提示词，支持 ${expr}；对象 / 数组会先解析 ${expr} / __ref 再序列化成 JSON */
  prompt: unknown;
  /** 追加的系统提示词，支持 ${expr} */
  system_prompt?: string;
  model?: string;
  /** Skill 包：远程 zip，根目录即单个 skill（有 SKILL.md）；url 支持 ${expr}，客户端进程内 url + version 相同只下载一次 */
  skills?: { url: string; version: string }[];
  /** json：把模型输出解析成对象（兼容 ```json 代码块），解析失败本步失败；默认 text */
  output_format?: "text" | "json";
  /** 毫秒，默认 600000 */
  timeout?: number;
}

export interface WorkflowItem {
  type: WorkflowStepType | string;
  /** 步骤名，只用于日志 */
  name?: string;
  url?: string;
  selector?: string;
  /**
   * 变量名 → URL 规则：本步网络请求命中时写入 { url, method, headers, queryParams, payload, response, cookies }。
   * 配了 capture 的步骤执行完动作后会等到所有变量都在本步命中，超时（见 wait）则本步失败。
   */
  capture?: Record<string, string>;
  /** 本步返回值写入的变量名（call_api / call_backend 返回体、run_agent 模型输出）；call_api_params 为数组时是按顺序的数组 */
  save_as?: string;
  /** 本步结束后：变量名 → 值（支持 ${expr} / 嵌套对象 / __ref），按书写顺序赋值 */
  set?: Record<string, unknown>;
  /** 本步结束后：数组变量名 → 要追加的值，用于跨轮累积 */
  append?: Record<string, unknown>;
  call_api_params?: CallApiParam | CallApiParam[];
  call_backend_params?: CallBackendParam;
  run_agent_params?: RunAgentStepParam;
  /** 批量 run_agent：失败项写 null、错误写入 ${save_as}_errors，不让整步失败 */
  allow_exception?: boolean;
  /** 步骤开始前求值，为真则跳过本步（loop 则跳过整个循环），如 "${replies[_index] == null}" */
  skip_if?: string;
  pass_condition?: string;
  /** 毫秒：有 capture 时为等待命中的超时（navigate 默认 15000，其余 10000）；没有 capture 时为动作后的固定等待（默认 3000） */
  wait?: number | string;
  wait_before_finish?: number | string;
  close_tab_before_finish?: string;
  children?: WorkflowItem[];
  /** loop / 批量 run_agent：要遍历的数组或 "${expr}"，开始时做快照 */
  list?: unknown;
  /** loop / 批量 run_agent：当前元素的变量名（配合 list），默认 _item；只在本步内有效 */
  item_var?: string;
  /** loop / 批量 run_agent：当前下标（从 0）的变量名，默认 _index；只在本步内有效 */
  index_var?: string;
  /** 批量 run_agent：同时进行的模型调用数，默认 1；结果按 list 顺序组成数组 */
  concurrency?: number;
  max_count?: number | string;
  break_condition?: string;
  recycle_count?: number;
  query_element_timeout?: number;
}

export interface WorkflowConfig {
  maxRetry?: number;
  /** 仅非浏览器任务（第一步不是 navigate）：运行中的非浏览器任务少于该值时才启动，默认 3；浏览器任务配置了会被拒绝 */
  max_task?: number;
  workflow?: WorkflowItem[];
  /** 任务所属平台；配合 needLogin 校验登录态 */
  platform?: HotelPlatform;
  /** true 时：navigate 到 platform 对应站点后必须已登录，未登录先尝试自动登录，仍失败则任务直接失败（不重试） */
  needLogin?: boolean;
}

export interface Collector {
  variables: Record<string, unknown>;
  /** 当前所在各层 loop 的下标，外层在前；loop 外为空数组 */
  loopPath: number[];
}

export type EmitFn = (message: string) => void;

export interface WorkflowResult {
  ok: boolean;
  data: { variables: Collector["variables"] } | null;
  error?: string | null;
  /** ok=false 时有值 */
  errorCode?: TaskErrorCode | null;
  /** errorCode=SITE_BLOCKED 时：被禁用扩展的站点 */
  blockedOrigin?: string;
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
  /** HTTP 状态码；请求未完成为 0 */
  status?: number;
  /** 请求失败：XHR 的 error / timeout / abort，或 fetch 的异常信息 */
  error?: string;
}

export interface NetworkUpdatePayload {
  requestData?: unknown;
  responseData?: unknown;
  api: string;
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}
