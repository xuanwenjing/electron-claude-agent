import type { CrawlResult } from "../../shared/crawl";
import type { RequestLogsApi } from "../../shared/requestLogs";
import type { AuthApi } from "../../shared/auth";
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
  busy?: boolean;
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

type ExtraRequestConfig = Omit<
  RequestConfig,
  "url" | "method" | "params" | "data"
>;

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
    requestLogsApi: RequestLogsApi;
    authApi: AuthApi;
    /** 经 IPC 由主进程 utils/request 发出，无 CSP / CORS 限制 */
    requestApi: {
      request: <T = any>(config: RequestConfig) => Promise<ApiResponse<T>>;
      get: <T = any>(
        url: string,
        params?: Record<string, unknown>,
        config?: ExtraRequestConfig,
      ) => Promise<ApiResponse<T>>;
      post: <T = any>(
        url: string,
        data?: unknown,
        config?: ExtraRequestConfig,
      ) => Promise<ApiResponse<T>>;
      put: <T = any>(
        url: string,
        data?: unknown,
        config?: ExtraRequestConfig,
      ) => Promise<ApiResponse<T>>;
      delete: <T = any>(
        url: string,
        params?: Record<string, unknown>,
        config?: ExtraRequestConfig,
      ) => Promise<ApiResponse<T>>;
    };
    crawlApi: {
      getStatus: () => Promise<{
        connected: boolean;
        port: number;
        extensionDir: string;
      }>;
      revealExtensionDir: () => Promise<
        { ok: true } | { ok: false; error: string }
      >;
      start: (config: unknown, taskId?: string) => Promise<CrawlResult>;
      cancel: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
      reloadExtension: () => Promise<
        { ok: true; taskId: string } | { ok: false; error: string }
      >;
      openUrl: (
        url: string,
      ) => Promise<{ ok: true } | { ok: false; error: string }>;
      onStatus: (
        handler: (data: { connected: boolean; port: number }) => void,
      ) => () => void;
      onProgress: (
        handler: (data: { taskId: string; message: string }) => void,
      ) => () => void;
    };
    updateApi: {
      meta: () => Promise<{
        version: string;
        packaged: boolean;
        busy: boolean;
      }>;
      getOpenAtLogin: () => Promise<{
        supported: boolean;
        openAtLogin: boolean;
      }>;
      setOpenAtLogin: (
        enabled: boolean,
      ) => Promise<{ supported: boolean; openAtLogin: boolean }>;
      check: () => Promise<
        { ok: true; message: string } | { ok: false; error: string }
      >;
      download: () => Promise<
        { ok: true; message: string } | { ok: false; error: string }
      >;
      onStatus: (handler: (event: UpdateStatusEvent) => void) => () => void;
    };
  }
}

export {};
