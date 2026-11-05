import type { CrawlResult } from "../shared/crawl";
import type { RequestLogsApi } from "../shared/requestLogs";
import type { AuthApi } from "../shared/auth";
import { contextBridge, ipcRenderer } from "electron";

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

contextBridge.exposeInMainWorld("crawlApi", {
  getStatus: (): Promise<{
    connected: boolean;
    port: number;
    extensionDir: string;
  }> => ipcRenderer.invoke("crawl:getStatus"),
  revealExtensionDir: (): Promise<
    { ok: true } | { ok: false; error: string }
  > => ipcRenderer.invoke("crawl:revealExtensionDir"),
  start: (config: unknown, taskId?: string): Promise<CrawlResult> =>
    ipcRenderer.invoke("crawl:start", config, taskId),
  cancel: (taskId: string) => ipcRenderer.invoke("crawl:cancel", taskId),
  reloadExtension: (): Promise<
    { ok: true; taskId: string } | { ok: false; error: string }
  > => ipcRenderer.invoke("crawl:reloadExtension"),
  openUrl: (
    url: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("crawl:openUrl", url),
  onStatus: (handler: (data: { connected: boolean; port: number }) => void) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      data: { connected: boolean; port: number },
    ) => handler(data);
    ipcRenderer.on("crawl:event:status", listener);
    return () => ipcRenderer.removeListener("crawl:event:status", listener);
  },
  onProgress: (
    handler: (data: { taskId: string; message: string }) => void,
  ) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      data: { taskId: string; message: string },
    ) => handler(data);
    ipcRenderer.on("crawl:event:progress", listener);
    return () => ipcRenderer.removeListener("crawl:event:progress", listener);
  },
});

type RequestConfig = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
};
type ExtraConfig = Omit<RequestConfig, "url" | "method" | "params" | "data">;

const request = <T = any>(config: RequestConfig): Promise<T> =>
  ipcRenderer.invoke("api:request", config);

contextBridge.exposeInMainWorld("requestApi", {
  request,
  get: (url: string, params?: Record<string, unknown>, config?: ExtraConfig) =>
    request({ ...config, url, method: "GET", params }),
  post: (url: string, data?: unknown, config?: ExtraConfig) =>
    request({ ...config, url, method: "POST", data }),
  put: (url: string, data?: unknown, config?: ExtraConfig) =>
    request({ ...config, url, method: "PUT", data }),
  delete: (
    url: string,
    params?: Record<string, unknown>,
    config?: ExtraConfig,
  ) => request({ ...config, url, method: "DELETE", params }),
});

contextBridge.exposeInMainWorld("updateApi", {
  meta: (): Promise<{ version: string; packaged: boolean; busy: boolean }> =>
    ipcRenderer.invoke("update:getMeta"),
  getOpenAtLogin: (): Promise<{ supported: boolean; openAtLogin: boolean }> =>
    ipcRenderer.invoke("app:getOpenAtLogin"),
  setOpenAtLogin: (
    enabled: boolean,
  ): Promise<{ supported: boolean; openAtLogin: boolean }> =>
    ipcRenderer.invoke("app:setOpenAtLogin", enabled),
  check: (): Promise<
    { ok: true; message: string } | { ok: false; error: string }
  > => ipcRenderer.invoke("update:check"),
  download: (): Promise<
    { ok: true; message: string } | { ok: false; error: string }
  > => ipcRenderer.invoke("update:download"),
  onStatus: (handler: (event: UpdateStatusEvent) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: UpdateStatusEvent) =>
      handler(event);
    ipcRenderer.on("update:event:status", listener);
    return () => ipcRenderer.removeListener("update:event:status", listener);
  },
});

const authApi: AuthApi = {
  getSession: () => ipcRenderer.invoke("auth:getSession"),
  refresh: () => ipcRenderer.invoke("auth:refresh"),
  sendSms: (mobile) => ipcRenderer.invoke("auth:sendSms", mobile),
  login: (mobile, code) => ipcRenderer.invoke("auth:login", mobile, code),
  chooseOutlet: (code) => ipcRenderer.invoke("auth:chooseOutlet", code),
  logout: (confirmed = false) => ipcRenderer.invoke("auth:logout", confirmed),
  onSession: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: Parameters<typeof handler>[0],
    ) => handler(state);
    ipcRenderer.on("auth:event:session", listener);
    return () => ipcRenderer.removeListener("auth:event:session", listener);
  },
};
contextBridge.exposeInMainWorld("authApi", authApi);

const requestLogsApi: RequestLogsApi = {
  read: () => ipcRenderer.invoke("requestLogs:read"),
  clear: () => ipcRenderer.invoke("requestLogs:clear"),
};
contextBridge.exposeInMainWorld("requestLogsApi", requestLogsApi);
