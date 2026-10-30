import { contextBridge, ipcRenderer } from "electron";

export type NoteDto = {
  id: number;
  content: string;
  createdAt: string;
};

contextBridge.exposeInMainWorld("dbApi", {
  info: (): Promise<
    { ok: true; path: string; count: number } | { ok: false; error: string }
  > => ipcRenderer.invoke("db:getInfo"),
  listNotes: (): Promise<
    { ok: true; notes: NoteDto[] } | { ok: false; error: string }
  > => ipcRenderer.invoke("notes:list"),
  addNote: (
    content: string,
  ): Promise<{ ok: true; note: NoteDto } | { ok: false; error: string }> =>
    ipcRenderer.invoke("notes:add", content),
  deleteNote: (id: number): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("notes:delete", id),
  clearNotes: (): Promise<
    { ok: true; deleted: number } | { ok: false; error: string }
  > => ipcRenderer.invoke("notes:clear"),
});

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

contextBridge.exposeInMainWorld("crawlApi", {
  getStatus: (): Promise<{ connected: boolean; port: number; extensionDir: string }> =>
    ipcRenderer.invoke("crawl:getStatus"),
  revealExtensionDir: (): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("crawl:revealExtensionDir"),
  start: (
    config: unknown,
  ): Promise<{ ok: true; taskId: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke("crawl:start", config),
  reloadExtension: (): Promise<
    { ok: true; taskId: string } | { ok: false; error: string }
  > => ipcRenderer.invoke("crawl:reloadExtension"),
  openXiaohongshu: (): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("crawl:openXiaohongshu"),
  listResults: (): Promise<
    | {
        ok: true;
        rows: Array<{
          id: number;
          taskId: string;
          ok: boolean;
          payload: string;
          payloadBytes: number;
          truncated: boolean;
          error: string | null;
          createdAt: string;
        }>;
      }
    | { ok: false; error: string }
  > => ipcRenderer.invoke("crawl:listResults"),
  onStatus: (handler: (data: { connected: boolean; port: number }) => void) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      data: { connected: boolean; port: number },
    ) => handler(data);
    ipcRenderer.on("crawl:event:status", listener);
    return () => ipcRenderer.removeListener("crawl:event:status", listener);
  },
  onProgress: (handler: (data: { taskId: string; message: string }) => void) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      data: { taskId: string; message: string },
    ) => handler(data);
    ipcRenderer.on("crawl:event:progress", listener);
    return () => ipcRenderer.removeListener("crawl:event:progress", listener);
  },
  onResult: (handler: (data: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: unknown) => handler(data);
    ipcRenderer.on("crawl:event:result", listener);
    return () => ipcRenderer.removeListener("crawl:event:result", listener);
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

const request = <T = any>(config: RequestConfig): Promise<T> => ipcRenderer.invoke("api:request", config);

contextBridge.exposeInMainWorld("requestApi", {
  request,
  get: (url: string, params?: Record<string, unknown>, config?: ExtraConfig) =>
    request({ ...config, url, method: "GET", params }),
  post: (url: string, data?: unknown, config?: ExtraConfig) =>
    request({ ...config, url, method: "POST", data }),
  put: (url: string, data?: unknown, config?: ExtraConfig) =>
    request({ ...config, url, method: "PUT", data }),
  delete: (url: string, params?: Record<string, unknown>, config?: ExtraConfig) =>
    request({ ...config, url, method: "DELETE", params }),
});

contextBridge.exposeInMainWorld("updateApi", {
  meta: (): Promise<{ version: string; packaged: boolean }> =>
    ipcRenderer.invoke("update:getMeta"),
  check: (): Promise<{ ok: true; message: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke("update:check"),
  download: (): Promise<{ ok: true; message: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke("update:download"),
  onStatus: (handler: (event: UpdateStatusEvent) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: UpdateStatusEvent) =>
      handler(event);
    ipcRenderer.on("update:event:status", listener);
    return () => ipcRenderer.removeListener("update:event:status", listener);
  },
});
