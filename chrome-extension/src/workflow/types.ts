import type { TaskErrorCode } from "../../../src/shared/bridgeProtocol";

export type WorkflowStepType =
  | "navigate"
  | "call_api"
  | "call_backend"
  | "click"
  | "loop";

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

export interface WorkflowItem {
  type: WorkflowStepType | string;
  name?: string;
  url?: string;
  selector?: string;
  event?: string;
  need_collect?: boolean;
  reg_exp?: string;
  global_variables?: GlobalVariable | GlobalVariable[];
  call_api_params?: CallApiParam | CallApiParam[];
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
  /** 任务所属平台；配合 needLogin 校验登录态 */
  platform?: HotelPlatform;
  /** true 时：navigate 到 platform 对应站点后必须已登录，否则任务直接失败（不重试） */
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

export type HotelPlatform = "ctripEbk" | "ctripHotel";

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
