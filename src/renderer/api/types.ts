export type AgentProgressEvent = {
  kind: "log" | "assistant" | "tool" | "result" | "error";
  text: string;
};

export type NoteDto = {
  id: number;
  content: string;
  createdAt: string;
};

export type UpdateStatusEvent = {
  kind:
    | "checking"
    | "available"
    | "not-available"
    | "progress"
    | "downloaded"
    | "error"
    | "disabled";
  message: string;
  version?: string;
  percent?: number;
};

export type CrawlResultRow = {
  id: number;
  taskId: string;
  ok: boolean;
  payload: string;
  payloadBytes: number;
  truncated: boolean;
  error: string | null;
  createdAt: string;
};

export type CrawlResultEvent = {
  taskId: string;
  ok: boolean;
  data?: unknown;
  error?: string | null;
  /** 见 src/shared/bridgeProtocol TaskErrorCode */
  errorCode?: string | null;
  saved?: unknown;
  /** 客户端直接下发的任务：workspace/crawl/<taskId>/result.json 绝对路径 */
  resultPath?: string | null;
};

export type LogKind = "log" | "assistant" | "tool" | "result" | "error";

export type LogLine = {
  id: string;
  kind: LogKind;
  text: string;
  at: number;
};

export type RequestConfig = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
};

type ExtraRequestConfig = Omit<RequestConfig, "url" | "method" | "params" | "data">;

/** 主进程 Request 的返回体；失败时为 { code: HTTP 状态 | axios 错误码 | -1, msg, data } */
export type ApiResponse<T = any> = {
  code: number | string;
  data: T;
  msg?: string;
  message?: string;
  [key: string]: unknown;
};

declare global {
  interface Window {
    /** 经 IPC 由主进程 utils/request 发出，无 CSP / CORS 限制 */
    requestApi: {
      request: <T = any>(config: RequestConfig) => Promise<ApiResponse<T>>;
      get: <T = any>(url: string, params?: Record<string, unknown>, config?: ExtraRequestConfig) => Promise<ApiResponse<T>>;
      post: <T = any>(url: string, data?: unknown, config?: ExtraRequestConfig) => Promise<ApiResponse<T>>;
      put: <T = any>(url: string, data?: unknown, config?: ExtraRequestConfig) => Promise<ApiResponse<T>>;
      delete: <T = any>(url: string, params?: Record<string, unknown>, config?: ExtraRequestConfig) => Promise<ApiResponse<T>>;
    };
    agentApi: {
      run: (
        prompt: string,
      ) => Promise<
        { ok: true; result: string } | { ok: false; error: string; stopped?: boolean }
      >;
      stop: () => Promise<{ ok: true } | { ok: false; error: string }>;
      onEvent: (handler: (event: AgentProgressEvent) => void) => () => void;
    };
    dbApi: {
      info: () => Promise<
        { ok: true; path: string; count: number } | { ok: false; error: string }
      >;
      listNotes: () => Promise<{ ok: true; notes: NoteDto[] } | { ok: false; error: string }>;
      addNote: (
        content: string,
      ) => Promise<{ ok: true; note: NoteDto } | { ok: false; error: string }>;
      deleteNote: (id: number) => Promise<{ ok: true } | { ok: false; error: string }>;
      clearNotes: () => Promise<{ ok: true; deleted: number } | { ok: false; error: string }>;
    };
    crawlApi: {
      getStatus: () => Promise<{ connected: boolean; port: number; extensionDir: string }>;
      revealExtensionDir: () => Promise<{ ok: true } | { ok: false; error: string }>;
      start: (
        config: unknown,
      ) => Promise<
        | { ok: true; taskId: string }
        | { ok: false; error: string; taskId?: string; resultPath?: string | null }
      >;
      reloadExtension: () => Promise<
        { ok: true; taskId: string } | { ok: false; error: string }
      >;
      openXiaohongshu: () => Promise<{ ok: true } | { ok: false; error: string }>;
      listResults: () => Promise<
        { ok: true; rows: CrawlResultRow[] } | { ok: false; error: string }
      >;
      onStatus: (handler: (data: { connected: boolean; port: number }) => void) => () => void;
      onProgress: (handler: (data: { taskId: string; message: string }) => void) => () => void;
      onResult: (handler: (data: CrawlResultEvent) => void) => () => void;
    };
    updateApi: {
      meta: () => Promise<{ version: string; packaged: boolean }>;
      check: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
      download: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
      onStatus: (handler: (event: UpdateStatusEvent) => void) => () => void;
    };
  }
}

export {};
