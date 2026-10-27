import axios from "axios";
import { ipcMain } from "electron";

import { Request } from "../utils/request";

/** renderer 可传的请求字段；baseURL 固定在主进程，不接受绝对 URL */
export type RendererRequestConfig = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
};

const api = new Request();

/** request 失败时返回 AxiosError（含 config / request），过 IPC 前转成可序列化的普通对象 */
function toSerializable(result: unknown): unknown {
  if (!axios.isAxiosError(result)) {
    return result instanceof Error ? { code: -1, msg: result.message, data: null } : result;
  }
  const body = result.response?.data as { msg?: string; message?: string } | undefined;
  return {
    code: result.response?.status ?? result.code ?? -1,
    msg: body?.msg || body?.message || result.message,
    data: result.response?.data ?? null,
  };
}

export function registerApiIpc(): void {
  ipcMain.handle("api:request", async (_event, config: RendererRequestConfig) => {
    if (!config || typeof config.url !== "string" || !config.url) {
      return { code: -1, msg: "url 不能为空", data: null };
    }
    if (/^[a-z][a-z\d+\-.]*:\/\//i.test(config.url)) {
      return { code: -1, msg: "不支持绝对 URL，请传相对 baseURL 的路径", data: null };
    }
    const { url, method, params, data, headers, timeout } = config;
    return toSerializable(await api.request({ url, method, params, data, headers, timeout }));
  });
}
