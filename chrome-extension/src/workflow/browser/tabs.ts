import { CONTENT_SCRIPT_FILE, PAGE_FETCH_PROXY_FILE } from "../../shared/constants";
import type { WorkflowItem } from "../types";
import { sleep } from "../util";

const TAB_COMPLETE_TIMEOUT_MS = 60000;
const PAGE_TEXT_PREVIEW_LENGTH = 150;
/** 页面被新的导航顶替时报的错，不算加载失败 */
const NAV_ABORTED_ERROR = "net::ERR_ABORTED";

/** tabId → 主框架最近一次加载失败的错误（net::ERR_*）；新导航开始时清掉 */
const mainFrameErrors = new Map<number, string>();
chrome.webNavigation.onBeforeNavigate.addListener(({ tabId, frameId }) => {
  if (frameId === 0) mainFrameErrors.delete(tabId);
});
chrome.webNavigation.onErrorOccurred.addListener(({ tabId, frameId, error }) => {
  if (frameId === 0 && error !== NAV_ABORTED_ERROR) mainFrameErrors.set(tabId, error);
});
chrome.tabs.onRemoved.addListener((tabId) => mainFrameErrors.delete(tabId));

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
      void describePage(tabId).then((page) => {
        emit(`页面 ${TAB_COMPLETE_TIMEOUT_MS / 1000}s 未加载完成，继续执行；${page}`);
        resolve();
      });
    }, TAB_COMPLETE_TIMEOUT_MS);
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

interface PageSnapshot {
  title: string;
  readyState: DocumentReadyState;
  /** 主文档 HTTP 状态码；拿不到为 0 */
  httpStatus: number;
  /** 页面打开至今的毫秒数 */
  elapsedMs: number;
  resourceCount: number;
  interceptor: boolean;
  text: string;
}

async function snapshotPage(tabId: number): Promise<PageSnapshot | null> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [PAGE_TEXT_PREVIEW_LENGTH],
    func: (maxLength: number) => {
      const nav = performance.getEntriesByType("navigation")[0] as
        | (PerformanceNavigationTiming & { responseStatus?: number })
        | undefined;
      return {
        title: document.title,
        readyState: document.readyState,
        httpStatus: nav?.responseStatus ?? 0,
        elapsedMs: Math.round(performance.now()),
        resourceCount: performance.getEntriesByType("resource").length,
        interceptor: !!(window as { __crawlNetworkInterceptor?: boolean }).__crawlNetworkInterceptor,
        text: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, maxLength),
      };
    },
  });
  return (res?.result as PageSnapshot | undefined) ?? null;
}

function loadErrorText(error: string): string {
  return `页面打开失败: ${error}（断网、DNS、代理或证书问题）`;
}

/** navigate 加载完后检查：浏览器错误页或主文档 HTTP ≥ 400 返回原因，正常返回 null */
export async function pageLoadProblem(tabId: number): Promise<string | null> {
  const error = mainFrameErrors.get(tabId);
  if (error) return loadErrorText(error);
  try {
    const page = await snapshotPage(tabId);
    if (page && page.httpStatus >= 400) return `页面返回 HTTP ${page.httpStatus}，页面文字「${page.text || "（空白）"}」`;
  } catch {
    /* 读不到页面内容交给后续步骤报错 */
  }
  return null;
}

/** 排查用的页面现状：URL、加载状态、HTTP 状态、耗时、拦截脚本是否在、页面开头的可见文字 */
export async function describePage(tabId: number): Promise<string> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return "页面状态：标签页已不存在";
  }
  const head = `页面状态：URL ${tab.url || tab.pendingUrl || "?"}，标签加载 ${tab.status ?? "?"}`;
  const error = mainFrameErrors.get(tabId);
  if (error) return `${head}，${loadErrorText(error)}`;
  const slowHint = tab.status === "loading" ? "；页面仍在加载：电脑或网络较慢，可调大该步 wait" : "";
  try {
    const page = await snapshotPage(tabId);
    if (!page) return `${head}${slowHint}`;
    return (
      `${head}，HTTP ${page.httpStatus || "?"}，document ${page.readyState}，` +
      `已打开 ${(page.elapsedMs / 1000).toFixed(1)}s，已加载资源 ${page.resourceCount} 个，` +
      `标题「${page.title}」，拦截脚本${page.interceptor ? "已注入" : "未注入"}，` +
      `页面文字「${page.text || "（空白）"}」${slowHint}`
    );
  } catch (err) {
    return `${head}，读取页面内容失败: ${err instanceof Error ? err.message : String(err)}${slowHint}`;
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
