import { authSession } from "../auth";
import { ipcMain } from "electron";

import { request } from "../utils/request";

/** renderer 可传的请求字段；baseURL 固定在主进程，不接受绝对 URL */
export type RendererRequestConfig = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
};

export function registerApiIpc(): void {
  ipcMain.handle(
    "api:request",
    async (_event, config: RendererRequestConfig) => {
      if (!config || typeof config.url !== "string" || !config.url) {
        return { code: -1, msg: "url 不能为空", data: null };
      }
      if (
        !config.url.startsWith("/") ||
        config.url.startsWith("//") ||
        config.url.includes("\\")
      ) {
        return {
          code: -1,
          msg: "不支持绝对 URL，请传相对 baseURL 的路径",
          data: null,
        };
      }
      const { url, method, params, data, headers, timeout } = config;
      try {
        if (!authSession.getState().user) throw new Error("请先登录");
        return await request.request({
          url,
          method,
          params,
          data,
          headers,
          timeout,
        });
      } catch (err) {
        return {
          code: 401,
          msg: err instanceof Error ? err.message : String(err),
          data: null,
        };
      }
    },
  );
}
