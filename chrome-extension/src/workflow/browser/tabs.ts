import { CONTENT_SCRIPT_FILE, PAGE_FETCH_PROXY_FILE } from "../../shared/constants";
import type { WorkflowItem } from "../types";
import { sleep } from "../util";

export async function waitTabComplete(tabId: number, emit: (message: string) => void): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
    const timer = setTimeout(() => {
      cleanup();
      emit(`等待页面加载超时，tabId=${tabId}`);
      resolve();
    }, 60000);
    function listener(id: number, info: { status?: string }) {
      if (id === tabId && info.status === "complete") {
        cleanup();
        resolve();
      }
    }
    function onRemoved(id: number) {
      if (id !== tabId) return;
      cleanup();
      reject(new Error(`任务标签页已关闭，tabId=${tabId}`));
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

export async function ensureContentReady(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
    });
    await sleep(200);
  }
}

export async function ensurePageFetchProxy(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [PAGE_FETCH_PROXY_FILE],
    world: "MAIN",
  });
}

export async function sendContentTask(
  tabId: number,
  workflowItem: WorkflowItem,
): Promise<{ success?: boolean; data?: unknown; errorMessage?: string } | undefined> {
  await ensureContentReady(tabId);
  return chrome.tabs.sendMessage(tabId, {
    type: "DO_COMMON_TASK",
    data: { workflowItem },
  });
}

export {
  ADOPT_WAIT_MS,
  adoptStartupWindowAsCrawlWindow,
  isCrawlWindow,
  getOrCreateCrawlWindow,
  acquireCrawlTab,
  navigateCrawlTab,
  removeTab,
  removeTabByUrlInWindow,
} from "./crawlWindow";
