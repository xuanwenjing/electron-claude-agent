import type { PageFetchResult } from "../types";
import { ensureContentReady, ensurePageFetchProxy } from "../browser";

/**
 * 在宿主页主世界发请求（credentials: include），禁止在 background 里 fetch。
 */
export async function pageFetch(
  tabId: number,
  url: string,
  options: RequestInit = {},
): Promise<PageFetchResult> {
  await ensureContentReady(tabId);
  await ensurePageFetchProxy(tabId);
  const res = await chrome.tabs.sendMessage(tabId, {
    type: "PAGE_FETCH",
    data: {
      url,
      options: {
        mode: "cors",
        credentials: "include",
        ...options,
      },
    },
  });
  if (!res?.success) {
    return {
      ok: false,
      body: null,
      headers: {},
      status: 0,
      statusText: res?.errorMessage || "pageFetch failed",
    };
  }
  return res.data as PageFetchResult;
}
