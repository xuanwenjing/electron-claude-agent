import type { TaskErrorCode } from "../../../src/shared/bridgeProtocol";

export type WorkflowStepType =
  | "navigate"
  | "call_api"
  | "call_backend"
  | "click"
  | "loop"
  | "run_agent";

export interface CallApiParam {
  url: string;
  method?: string;
  headers?: Record<string, unknown>;
  payload?: unknown;
  query_params?: Record<string, unknown>;
  mode?: string;
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
  name?: string;
  url?: string;
  selector?: string;
  event?: string;
  need_collect?: boolean;
  reg_exp?: string;
  /** 变量名 → URL 规则：本步网络请求命中时写入 { url, method, headers, queryParams, payload, response, cookies } */
  capture?: Record<string, string>;
  /** 本步返回值写入的变量名（call_backend 返回体、run_agent 模型输出） */
  save_as?: string;
  /** 本步结束后：变量名 → 值（支持 ${expr} / 嵌套对象 / __ref），按书写顺序赋值 */
  set?: Record<string, unknown>;
  /** 本步结束后：数组变量名 → 要追加的值，用于跨轮累积 */
  append?: Record<string, unknown>;
  call_api_params?: CallApiParam | CallApiParam[];
  call_backend_params?: CallBackendParam;
  run_agent_params?: RunAgentStepParam;
  allow_exception?: boolean;
  pass_condition?: string;
  wait?: number | string;
  wait_before_finish?: number | string;
  close_tab_before_finish?: string;
  children?: WorkflowItem[];
  /** loop：要遍历的数组或 "${expr}"，开始时做快照 */
  list?: unknown;
  /** loop：当前元素的变量名（配合 list），默认 _item；只在循环内有效 */
  item_var?: string;
  /** loop：当前下标（从 0）的变量名，默认 _index；只在循环内有效 */
  index_var?: string;
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

export interface CollectedText {
  type: "text";
  value: unknown;
}

export interface CollectedArray {
  type: "array";
  content: unknown[];
}

export const HotelPlatform = {
  CtripEbk: "ctripEbk",
  CtripHotel: "ctripHotel",
  Meituan: "meituan",
  Douyin: "douyin",
  Fliggy: "fliggy",
} as const;

export type HotelPlatform = (typeof HotelPlatform)[keyof typeof HotelPlatform];

/** navigate 到携程 EBK / 携程酒店后自动写入 collected.hotelInfo */
export interface CollectedHotelInfo {
  type: "hotel_info";
  platform: HotelPlatform;
  value: Record<string, unknown>;
}

export interface CollectedObject {
  type: "object";
  value: Record<string, unknown>;
}

export type CollectedEntry = CollectedText | CollectedArray | CollectedHotelInfo | CollectedObject;

export interface Collector {
  data: Record<string, CollectedEntry>;
  variables: Record<string, unknown>;
  /** 当前所在各层 loop 的下标，外层在前；loop 外为空数组 */
  loopPath: number[];
}

export type EmitFn = (message: string) => void;

export interface WorkflowResult {
  ok: boolean;
  data: { collected: Collector["data"]; variables: Collector["variables"] } | null;
  error?: string | null;
  /** ok=false 时有值 */
  errorCode?: TaskErrorCode | null;
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
