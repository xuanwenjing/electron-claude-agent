/**
 * 注入到页面 MAIN world，用页面 window.fetch。
 */
import { PAGE_FETCH_SOURCE } from "../shared/constants";

declare global {
  interface Window {
    __crawlPageFetchProxy?: boolean;
  }
}

function main(): void {
  if (window.__crawlPageFetchProxy) return;
  window.__crawlPageFetchProxy = true;

  window.addEventListener("message", async (event) => {
    if (!event.data || event.data.source !== PAGE_FETCH_SOURCE) return;
    const { type, requestId, data } = event.data;
    if (type !== "PAGE_FETCH_REQUEST") return;

    try {
      const { url, options } = data as { url: string; options?: RequestInit };
      const response = await window.fetch(url, options);
      const text = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      window.postMessage(
        {
          type: "PAGE_FETCH_RESPONSE",
          requestId,
          success: true,
          data: {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: (() => {
              const h: Record<string, string> = {};
              response.headers.forEach((value, key) => {
                h[key] = value;
              });
              return h;
            })(),
            body,
          },
        },
        event.origin,
      );
    } catch (error) {
      window.postMessage(
        {
          type: "PAGE_FETCH_RESPONSE",
          requestId,
          success: false,
          errorMessage: `[pageFetch] ${error instanceof Error ? error.message : String(error)}`,
        },
        event.origin,
      );
    }
  });
}

main();
