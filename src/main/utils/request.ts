import { requestLogs } from "../diagnostics/requestLogs";
import axios from "axios";
import { app } from "electron";
import type {
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
  AxiosResponse,
  RawAxiosRequestHeaders,
} from "axios";

export type RequestContext = { token?: string; outletCode?: string };
let getContext: () => RequestContext = () => ({});

/** 由登录模块注册，发送每个请求时读取，避免缓存旧 token 或门店。 */
export function setRequestContextProvider(
  provider: () => RequestContext,
): void {
  getContext = provider;
}

export const defaultSettings = {
  source: "electron-client",
};

export class Request {
  private service: AxiosInstance;

  constructor(options: AxiosRequestConfig = {}) {
    this.service = axios.create({
      baseURL: process.env.CLIENT_API_BASE_URL || "http://localhost:3000",
      ...options,
      timeout: 120000,
    });

    this.setupInterceptors();
  }

  private getRequestHeaders(
    options: RawAxiosRequestHeaders,
    context: RequestContext,
  ) {
    const headers: RawAxiosRequestHeaders = {
      "Content-Type": "application/json",
      ...defaultSettings,
      ...options,
    };
    // 公共身份信息以主进程会话为准，不允许调用方通过 headers 覆盖。
    for (const key of Object.keys(headers)) {
      if (
        ["authorization", "outlet-code", "outlet_code"].includes(
          key.toLowerCase(),
        )
      )
        delete headers[key];
    }
    if (context.token) headers.Authorization = `Bearer ${context.token}`;
    if (context.outletCode) headers.outlet_code = context.outletCode;
    return headers;
  }

  private setupInterceptors() {
    // 请求拦截器
    this.service.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        config.headers["X-Client-Version"] = app.getVersion();
        return config;
      },
      (error) => Promise.reject(error),
    );

    // 响应拦截器
    this.service.interceptors.response.use(
      async (response: AxiosResponse) => {
        const { data } = response;
        switch (data?.code) {
          case "1":
          case "200":
          case "success":
            data.code = 200;
            break;
          case "AUTH-INVALID-001":
          case "AUTH-REFRESH-INVALID":
          case "token无效":
          case "AUTH-TOKEN-INVALID":
          case "401":
            data.code = 401;
            // await common_chromeLocalStorage.remove('userInfo');
            // await this.options.handleLoginOut?.();
            break;
          // case 'internal_server_error':
          //   await this.options.handleHotelUnvalid?.();
          //   break;
        }
        return response;
      },
      (error) => Promise.reject(error),
    );
  }

  public async request<T = any>(
    config: AxiosRequestConfig,
    context?: RequestContext,
  ): Promise<T> {
    const started = Date.now();
    let logId: number | undefined;
    try {
      const requestConfig = {
        baseURL: process.env.CLIENT_API_BASE_URL || "http://localhost:3000",
        ...config,
        headers: this.getRequestHeaders(
          config.headers || {},
          context ?? getContext(),
        ),
      };
      logId = requestLogs.begin(requestConfig);
      const response = await this.service(requestConfig);
      const code = response.data?.code;
      requestLogs.finish(logId, {
        status: response.status,
        body: response.data,
        durationMs: Date.now() - started,
        failed:
          code !== undefined &&
          !["200", "0", "success", "1"].includes(String(code)),
      });
      return response.data;
    } catch (error: any) {
      if (logId !== undefined)
        requestLogs.finish(logId, {
          status: error.response?.status,
          body: error.response?.data ?? {
            message: "请求未完成，请检查网络、服务地址或超时设置",
            code: error.code,
          },
          durationMs: Date.now() - started,
          failed: true,
        });
      return {
        code: error.response?.status ?? error.code ?? -1,
        msg:
          error.response?.data?.msg ||
          error.response?.data?.message ||
          error.message ||
          "请求失败",
        data: null,
      } as T;
    }
  }
}

/** 业务接口统一复用此实例。 */
export const request = new Request();
