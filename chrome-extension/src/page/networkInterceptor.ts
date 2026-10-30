/**
 * MAIN 世界：拦截 XHR / fetch，对齐 wormhole xhrInterceptor。
 */
import { XHR_RESPONSE_TYPE } from "../shared/constants";

declare global {
  interface Window {
    __crawlNetworkInterceptor?: boolean;
  }
  interface XMLHttpRequest {
    _crawlUrl?: string;
    _crawlMethod?: string;
    _crawlRequestHeaders?: Record<string, string>;
    _crawlBody?: unknown;
  }
}

function main(): void {
  if (window.__crawlNetworkInterceptor) return;
  window.__crawlNetworkInterceptor = true;

  const getDocumentCookie = () => {
    try {
      return document.cookie || "";
    } catch {
      return "";
    }
  };

  const sendResponseData = (
    api: unknown,
    method: unknown,
    body: unknown,
    response: unknown,
    headers: unknown,
    responseURL: unknown,
    status?: number,
    error?: string,
  ) => {
    try {
      window.postMessage(
        {
          type: XHR_RESPONSE_TYPE,
          data: {
            api,
            method,
            body,
            response,
            headers,
            responseURL,
            cookie: getDocumentCookie(),
            status,
            error,
          },
        },
        "*",
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "DataCloneError") {
        return sendResponseData(api, method, "{}", response, headers, responseURL, status, error);
      }
    }
  };

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    this._crawlUrl = String(url);
    this._crawlMethod = method;
    this._crawlRequestHeaders = this._crawlRequestHeaders || {};
    return (originalXHROpen as (...args: unknown[]) => void).apply(this, [
      method,
      url,
      ...rest,
    ]);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (header: string, value: string) {
    this._crawlRequestHeaders = this._crawlRequestHeaders || {};
    this._crawlRequestHeaders[header] = value;
    return originalXHRSetRequestHeader.apply(this, [header, value]);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    this._crawlBody = body;
    this._crawlMethod = this._crawlMethod || "POST";

    this.addEventListener("load", function (this: XMLHttpRequest) {
      try {
        let responseData: unknown;
        try {
          if (this.responseType === "json") {
            responseData = this.response;
          } else if (this.responseText) {
            responseData = JSON.parse(this.responseText);
          } else {
            responseData = { code: this.status };
          }
        } catch {
          responseData = { code: this.status };
        }
        sendResponseData(
          this._crawlUrl,
          this._crawlMethod,
          this._crawlBody,
          responseData,
          this._crawlRequestHeaders,
          this.responseURL,
          this.status,
        );
      } catch {
        sendResponseData(
          this._crawlUrl,
          this._crawlMethod,
          this._crawlBody,
          { code: this.status || 0 },
          this._crawlRequestHeaders,
          this.responseURL,
          this.status,
        );
      }
    });
    for (const failure of ["error", "timeout", "abort"]) {
      this.addEventListener(failure, function (this: XMLHttpRequest) {
        sendResponseData(
          this._crawlUrl,
          this._crawlMethod,
          this._crawlBody,
          { code: 0 },
          this._crawlRequestHeaders,
          this.responseURL,
          this.status,
          failure,
        );
      });
    }

    return originalXHRSend.apply(this, [body]);
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url || "";
    const method = init?.method || (input instanceof Request ? input.method : "GET");
    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else {
        Object.assign(headers, init.headers);
      }
    }

    let body = "";
    try {
      const requestBody =
        init?.body ||
        (input instanceof Request
          ? await input
              .clone()
              .text()
              .catch(() => "")
          : "");
      body = typeof requestBody === "string" ? requestBody : JSON.stringify(requestBody) || "";
    } catch {
      /* ignore */
    }

    let response: Response;
    try {
      response = await originalFetch(input, init);
    } catch (err) {
      const message = err instanceof Error ? err.message : "network error";
      sendResponseData(url, method, body, { code: 0, error: message }, headers, url, 0, message);
      throw err;
    }
    const cloned = response.clone();
    cloned
      .text()
      .then((text) => {
        try {
          sendResponseData(url, method, body, JSON.parse(text), headers, url, response.status);
        } catch {
          sendResponseData(url, method, body, { code: response.status || 0, raw: text }, headers, url, response.status);
        }
      })
      .catch((err: Error) => {
        const message = err?.message || "network error";
        sendResponseData(url, method, body, { code: 0, error: message }, headers, url, response.status, message);
      });

    return response;
  };
}

main();
