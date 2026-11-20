// @ts-ignore
import axios from 'axios';
import type {
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
  AxiosResponse,
  RawAxiosRequestHeaders,
} from 'axios';

/**
 * 插件 API 前缀（相对 VITE_BASE_URL 的请求路径前缀）。
 * 现为 wormhole-hotelds-api 网关路径（行为基准）；后续切 wormhole-revenue 时仅改此值，如 '/revenue-api'。
 */

export const defaultSettings = {
  Source: 'chrome-plugin',
};

export class Request {
  private service: AxiosInstance;

  constructor(options: AxiosRequestConfig = {}) {
    this.service = axios.create({
      baseURL: `/abc`,
      timeout: 120000,
    });

    this.setupInterceptors();
  }

  private getRequestHeaders(options: RawAxiosRequestHeaders) {
    const headers: RawAxiosRequestHeaders = {
      'Content-Type': 'application/json',
      ...defaultSettings,
      ...options,
    };
    return headers;
  }

  private setupInterceptors() {
    // 请求拦截器
    this.service.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        if (chrome.runtime.getManifest?.()?.version) {
          config.headers['Plugin-Version'] = chrome.runtime.getManifest().version;
        }
        return config;
      },
      error => Promise.reject(error),
    );

    // 响应拦截器
    this.service.interceptors.response.use(
      async (response: AxiosResponse) => {
        const { data, config } = response;
        switch (data.code) {
          case '1':
          case '200':
          case 'success':
            data.code = 200;
            break;
          case 'AUTH-INVALID-001':
          case 'AUTH-REFRESH-INVALID':
          case 'token无效':
          case 'AUTH-TOKEN-INVALID':
          case '401':
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
      error => Promise.reject(error),
    );
  }

  public async request<T = any>(config: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.service({
        ...config,
        headers: this.getRequestHeaders(config.headers || {}),
      });
      return response.data;
    } catch (error: any) {
      if (error?.message) {
        error.msg = error?.message;
      }
      console.error('[Request] 请求失败', config.url, config.data, config.params);
      return Promise.resolve(error as any);
    }
  }
}
