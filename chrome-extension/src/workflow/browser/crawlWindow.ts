/**
 * 对齐 wormhole 采集窗口标签策略：
 * - 窗口创建时自带第 1 个标签（index=0）作保活
 * - createTaskStore：从 tabs.slice(1) 找空闲工作标签，没有再 tabs.create
 * - 任务结束 removeTab 关绑定的工作标签（不会绑到首标签，无需关时再过滤）
 */

import { urlMatch } from "../util";

const STORAGE_KEY = "currentCrawlWindow";

export async function getOrCreateCrawlWindow(): Promise<number> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const existingId = stored[STORAGE_KEY] as number | undefined;
  if (existingId != null) {
    try {
      await chrome.windows.get(existingId);
      return existingId;
    } catch {
      await chrome.storage.local.remove(STORAGE_KEY);
    }
  }

  const win = await chrome.windows.create({ state: "minimized" });
  if (!win?.id) throw new Error("打开采集窗口失败");
  await chrome.storage.local.set({ [STORAGE_KEY]: win.id });
  return win.id;
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
