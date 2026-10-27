/**
 * Content Script（隔离世界）
 * - DO_COMMON_TASK: click
 * - PAGE_FETCH / XHR 转发
 */
import { PAGE_FETCH_SOURCE, XHR_RESPONSE_TYPE } from "../shared/constants";
import type { WorkflowItem } from "../workflow/types";
import { handleClickTask } from "./dom";

declare global {
  interface Window {
    __crawlBridgeContent?: boolean;
  }
}

function main(): void {
  if (window.__crawlBridgeContent) return;
  window.__crawlBridgeContent = true;

  const pendingFetch = new Map<
    string,
    (value: { success: boolean; data?: unknown; errorMessage?: string }) => void
  >();

  window.addEventListener("message", (event) => {
    if (!event.data) return;

    if (event.data.type === XHR_RESPONSE_TYPE) {
      try {
        chrome.runtime.sendMessage({
          type: "XHR_RESPONSE",
          data: event.data.data,
        });
      } catch {
        /* SW 休眠时忽略 */
      }
      return;
    }

    if (event.data.type !== "PAGE_FETCH_RESPONSE") return;
    const { requestId, success, data, errorMessage } = event.data;
    const resolve = pendingFetch.get(requestId);
    if (!resolve) return;
    pendingFetch.delete(requestId);
    resolve({ success, data, errorMessage });
  });

  function pageFetchFromMainWorld(url: string, options: RequestInit) {
    const requestId = `${Date.now()}-${Math.random()}`;
    return new Promise<{ success: boolean; data?: unknown; errorMessage?: string }>((resolve) => {
      pendingFetch.set(requestId, resolve);
      window.postMessage(
        {
          source: PAGE_FETCH_SOURCE,
          type: "PAGE_FETCH_REQUEST",
          requestId,
          data: { url, options },
        },
        window.location.origin,
      );
      setTimeout(() => {
        if (pendingFetch.has(requestId)) {
          pendingFetch.delete(requestId);
          resolve({ success: false, errorMessage: "[pageFetch] 超时" });
        }
      }, 60000);
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "PAGE_FETCH") {
      const { url, options } = message.data || {};
      pageFetchFromMainWorld(url, {
        mode: "cors",
        credentials: "include",
        ...(options || {}),
      }).then(sendResponse);
      return true;
    }

    if (message?.type !== "DO_COMMON_TASK") return false;
    const item = (message.data?.workflowItem || {}) as WorkflowItem;
    const timeout = item.query_element_timeout ?? 20000;
    (async () => {
      try {
        if (item.type === "click") {
          return sendResponse(await handleClickTask({ ...item, timeout }));
        }
        return sendResponse({
          success: false,
          errorMessage: `不支持的 content 步骤: ${item.type}`,
        });
      } catch (err) {
        sendResponse({
          success: false,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  });
}

main();
