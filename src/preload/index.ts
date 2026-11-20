import type { CrawlApi } from "../shared/crawl";
import type { RequestApi, RequestConfig } from "../shared/request";
import type { RequestLogsApi } from "../shared/requestLogs";
import type { AuthApi } from "../shared/auth";
import type { UpdateApi } from "../shared/update";
import { contextBridge, ipcRenderer } from "electron";

/** 订阅主进程推送，返回取消订阅函数。 */
function subscribe<T>(channel: string, handler: (data: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, data: T) => handler(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const crawlApi: CrawlApi = {
  getStatus: () => ipcRenderer.invoke("crawl:getStatus"),
  revealExtensionDir: () => ipcRenderer.invoke("crawl:revealExtensionDir"),
  start: (config, taskId) => ipcRenderer.invoke("crawl:start", config, taskId),
  cancel: (taskId) => ipcRenderer.invoke("crawl:cancel", taskId),
  reloadExtension: () => ipcRenderer.invoke("crawl:reloadExtension"),
  openUrl: (url) => ipcRenderer.invoke("crawl:openUrl", url),
  onStatus: (handler) => subscribe("crawl:event:status", handler),
  onProgress: (handler) => subscribe("crawl:event:progress", handler),
};
contextBridge.exposeInMainWorld("crawlApi", crawlApi);

const request = (config: RequestConfig) => ipcRenderer.invoke("api:request", config);
const requestApi: RequestApi = {
  request,
  get: (url, params, config) => request({ ...config, url, method: "GET", params }),
  post: (url, data, config) => request({ ...config, url, method: "POST", data }),
  put: (url, data, config) => request({ ...config, url, method: "PUT", data }),
  delete: (url, params, config) => request({ ...config, url, method: "DELETE", params }),
};
contextBridge.exposeInMainWorld("requestApi", requestApi);

const updateApi: UpdateApi = {
  meta: () => ipcRenderer.invoke("update:getMeta"),
  getOpenAtLogin: () => ipcRenderer.invoke("app:getOpenAtLogin"),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke("app:setOpenAtLogin", enabled),
  check: () => ipcRenderer.invoke("update:check"),
  download: () => ipcRenderer.invoke("update:download"),
  onStatus: (handler) => subscribe("update:event:status", handler),
};
contextBridge.exposeInMainWorld("updateApi", updateApi);

const authApi: AuthApi = {
  getSession: () => ipcRenderer.invoke("auth:getSession"),
  refresh: () => ipcRenderer.invoke("auth:refresh"),
  sendSms: (mobile) => ipcRenderer.invoke("auth:sendSms", mobile),
  login: (mobile, code) => ipcRenderer.invoke("auth:login", mobile, code),
  chooseOutlet: (code) => ipcRenderer.invoke("auth:chooseOutlet", code),
  logout: (confirmed = false) => ipcRenderer.invoke("auth:logout", confirmed),
  onSession: (handler) => subscribe("auth:event:session", handler),
};
contextBridge.exposeInMainWorld("authApi", authApi);

const requestLogsApi: RequestLogsApi = {
  read: () => ipcRenderer.invoke("requestLogs:read"),
  clear: () => ipcRenderer.invoke("requestLogs:clear"),
  readConsole: () => ipcRenderer.invoke("requestLogs:readConsole"),
  clearConsole: () => ipcRenderer.invoke("requestLogs:clearConsole"),
};
contextBridge.exposeInMainWorld("requestLogsApi", requestLogsApi);
