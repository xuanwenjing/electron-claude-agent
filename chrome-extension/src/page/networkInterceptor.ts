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
          },
        },
        "*",
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "DataCloneError") {
        return sendResponseData(api, method, "{}", response, headers, responseURL);
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
        );
      } catch {
        sendResponseData(
          this._crawlUrl,
          this._crawlMethod,
          this._crawlBody,
          { code: this.status || 0 },
          this._crawlRequestHeaders,
          this.responseURL,
        );
      }
    });

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

    const response = await originalFetch(input, init);
    const cloned = response.clone();
    cloned
      .text()
      .then((text) => {
        try {
          sendResponseData(url, method, body, JSON.parse(text), headers, url);
        } catch {
          sendResponseData(url, method, body, { code: response.status || 0, raw: text }, headers, url);
        }
      })
      .catch((err: Error) => {
        sendResponseData(
          url,
          method,
          body,
          { code: 0, error: err?.message || "network error" },
          headers,
          url,
        );
      });

    return response;
  };
}

main();
