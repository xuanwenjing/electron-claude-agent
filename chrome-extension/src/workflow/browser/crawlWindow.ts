/**
 * 对齐 wormhole 采集窗口标签策略：
 * - 窗口创建时自带第 1 个标签（index=0）作保活
 * - createTaskStore：从 tabs.slice(1) 找空闲工作标签，没有再 tabs.create
 * - 任务结束 removeTab 关绑定的工作标签（不会绑到首标签，无需关时再过滤）
 */

import { urlMatch } from "../util";

const STORAGE_KEY = "currentCrawlWindow";
const BLANK_TAB_URL = /^(about:blank|(edge|chrome):\/\/(newtab|new-tab-page)\/?)$/;
/** 浏览器刚被拉起时启动窗口可能明显晚于扩展连接出现 */
export const ADOPT_WAIT_MS = 10_000;

let adopting: Promise<void> | null = null;
/** 最近一次收编结果，供任务日志说明采集窗口来源 */
let adoptNote: string | null = null;

function isBlankStartupWindow(win: chrome.windows.Window): boolean {
  const tabs = win.tabs ?? [];
  if (win.type !== "normal" || tabs.length !== 1) return false;
  const url = tabs[0].url || tabs[0].pendingUrl || "about:blank";
  return BLANK_TAB_URL.test(url);
}

function describeWindows(windows: chrome.windows.Window[]): string {
  if (!windows.length) return "无普通窗口";
  return windows
    .map((w) => `#${w.id}[${(w.tabs ?? []).map((t) => t.url || t.pendingUrl || "?").join(", ")}]`)
    .join("; ");
}

async function findBlankStartupWindow(): Promise<{ id: number | null; windows: chrome.windows.Window[] }> {
  const deadline = Date.now() + ADOPT_WAIT_MS;
  for (;;) {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    const win = windows.find(isBlankStartupWindow);
    if (win?.id != null) return { id: win.id, windows };
    if (Date.now() >= deadline) return { id: null, windows };
    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * 客户端拉起浏览器后调用：没有可用采集窗口时，把只含一个空白标签的启动窗口收编为采集窗口，
 * 避免启动窗口 + 采集窗口两个窗口。其首标签即保活标签。
 */
export function adoptStartupWindowAsCrawlWindow(): Promise<void> {
  adopting ??= (async () => {
    try {
      const existing = await getValidStoredWindow();
      if (existing != null) {
        adoptNote = `已有采集窗口 #${existing}，不收编启动窗口`;
        return;
      }
      const { id, windows } = await findBlankStartupWindow();
      if (id != null) {
        await chrome.storage.local.set({ [STORAGE_KEY]: id });
        adoptNote = `收编浏览器启动窗口 #${id} 作为采集窗口`;
      } else {
        adoptNote = `${ADOPT_WAIT_MS / 1000}s 内未找到只含空白标签的启动窗口（${describeWindows(windows)}），将新建采集窗口`;
      }
    } catch (err) {
      adoptNote = `收编启动窗口出错：${err instanceof Error ? err.message : String(err)}`;
    } finally {
      adopting = null;
    }
  })();
  return adopting;
}

async function getValidStoredWindow(): Promise<number | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const existingId = stored[STORAGE_KEY] as number | undefined;
  if (existingId == null) return null;
  try {
    await chrome.windows.get(existingId);
    return existingId;
  } catch {
    await chrome.storage.local.remove(STORAGE_KEY);
    return null;
  }
}

export async function isCrawlWindow(windowId: number | undefined): Promise<boolean> {
  if (windowId == null) return false;
  if (adopting) await adopting;
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] === windowId;
}

/** note：采集窗口来源说明（收编 / 复用 / 新建），用于任务日志 */
export async function getOrCreateCrawlWindow(): Promise<{ windowId: number; note: string }> {
  if (adopting) await adopting;
  const pendingNote = adoptNote;
  adoptNote = null;
  const existingId = await getValidStoredWindow();
  if (existingId != null) return { windowId: existingId, note: pendingNote ?? `复用采集窗口 #${existingId}` };

  const win = await chrome.windows.create({ state: "minimized" });
  if (!win?.id) throw new Error("打开采集窗口失败");
  await chrome.storage.local.set({ [STORAGE_KEY]: win.id });
  return { windowId: win.id, note: `${pendingNote ? `${pendingNote}；` : ""}新建采集窗口 #${win.id}` };
}

/** 对齐 createTaskStore */
export async function acquireCrawlTab(windowId: number): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({ windowId });
  const freeTab = tabs.slice(1).find((tab) => !!tab.id);
  if (freeTab?.id != null) {
    return freeTab;
  }
  const tab = await chrome.tabs.create({ windowId });
  if (!tab?.id) throw new Error("在采集窗口创建标签页失败");
  return tab;
}

/** 对齐 navigateTo */
export async function navigateCrawlTab(tabId: number, url: string): Promise<chrome.tabs.Tab> {
  let tab: chrome.tabs.Tab | undefined = await chrome.tabs.get(tabId);
  if (tab && tab.id) {
    if (url.split("#")[0] !== tab.url?.split("#")[0]) {
      try {
        tab = await chrome.tabs.update(tab.id, { url });
      } catch {
        tab = await chrome.tabs.create({ url });
      }
    } else {
      await chrome.tabs.reload(tab.id);
    }
  }
  if (!tab || !tab.id) throw new Error("navigateCrawlTab 标签页加载失败");
  return tab;
}

/** 对齐 removeTab */
export async function removeTab(tabId: number | null | undefined): Promise<void> {
  if (tabId == null) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    /* ignore */
  }
}

export async function removeTabByUrlInWindow(
  windowId: number | null,
  reg: string | undefined,
): Promise<void> {
  if (!reg || windowId == null) return;
  const tabs = await chrome.tabs.query({ windowId });
  for (const tab of tabs) {
    if (tab.index === 0) continue;
    if (tab.id == null || !urlMatch(tab.url, reg)) continue;
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      /* ignore */
    }
  }
}
