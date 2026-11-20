/** renderer 可传的请求字段；baseURL 固定在主进程，不接受绝对 URL */
export type RequestConfig = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
};

export type ExtraRequestConfig = Omit<RequestConfig, "url" | "method" | "params" | "data">;

/** 主进程 Request 的返回体；失败时为 { code: HTTP 状态 | axios 错误码 | -1, msg, data } */
export type ApiResponse<T = any> = {
  code: number | string;
  data: T;
  msg?: string;
  message?: string;
  [key: string]: unknown;
};

/** 经 IPC 由主进程 utils/request 发出，无 CSP / CORS 限制 */
export type RequestApi = {
  request: <T = any>(config: RequestConfig) => Promise<ApiResponse<T>>;
  get: <T = any>(
    url: string,
    params?: Record<string, unknown>,
    config?: ExtraRequestConfig,
  ) => Promise<ApiResponse<T>>;
  post: <T = any>(url: string, data?: unknown, config?: ExtraRequestConfig) => Promise<ApiResponse<T>>;
  put: <T = any>(url: string, data?: unknown, config?: ExtraRequestConfig) => Promise<ApiResponse<T>>;
  delete: <T = any>(
    url: string,
    params?: Record<string, unknown>,
    config?: ExtraRequestConfig,
  ) => Promise<ApiResponse<T>>;
};
