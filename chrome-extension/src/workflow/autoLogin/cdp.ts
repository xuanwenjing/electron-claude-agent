import { CRAWL_OVERLAY_HOST_ID } from "../../shared/constants";

/**
 * 对齐 wormhole taskAutoLogin 的 CDP 工具：
 * 密码管理器只响应 isTrusted 的真实点击，content script 的 el.click() 不会触发填充。
 */

/** 在页面坐标处显示点击位置（红点 + 扩散波纹），约 1.5 秒后消失 */
export async function showClickIndicator(tabId: number, x: number, y: number): Promise<void> {
  await chrome.scripting
    .executeScript({
      target: { tabId },
      world: "MAIN",
      func: (cx: number, cy: number) => {
        const container = document.createElement("div");
        container.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;width:0;height:0;pointer-events:none;z-index:2147483647;`;

        const dot = document.createElement("div");
        dot.style.cssText =
          "position:absolute;width:14px;height:14px;border-radius:50%;background:rgba(255,50,50,0.9);" +
          "transform:translate(-50%,-50%);box-shadow:0 0 0 2px rgba(255,255,255,0.8);";

        const ripple = document.createElement("div");
        ripple.style.cssText =
          "position:absolute;width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,50,50,0.8);" +
          "transform:translate(-50%,-50%) scale(1);animation:__cdp_ripple__ 1s ease-out forwards;";

        const style = document.createElement("style");
        style.textContent =
          "@keyframes __cdp_ripple__{0%{transform:translate(-50%,-50%) scale(1);opacity:1}" +
          "100%{transform:translate(-50%,-50%) scale(4.5);opacity:0}}";

        document.head.appendChild(style);
        container.appendChild(dot);
        container.appendChild(ripple);
        document.documentElement.appendChild(container);
        setTimeout(() => {
          container.remove();
          style.remove();
        }, 1500);
      },
      args: [x, y],
    })
    .catch(() => {});
}

/** 采集窗口蒙层会拦截 CDP 真实鼠标事件：派发前隐藏，结束后恢复 */
export async function setCrawlOverlayHidden(tabId: number, hidden: boolean): Promise<void> {
  await chrome.scripting
    .executeScript({
      target: { tabId },
      func: (id: string, hide: boolean) => {
        const host = document.getElementById(id);
        if (host) host.style.display = hide ? "none" : "";
      },
      args: [CRAWL_OVERLAY_HOST_ID, hidden],
    })
    .catch(() => {});
}

/**
 * 用 CDP 真实点击元素。
 * chrome.debugger.attach 会在页面顶部插入横条使内容下移，所以必须 attach 之后再查坐标。
 * 返回是否派发了点击（元素不存在返回 false）。
 */
export async function sendCdpClickBySelector(tabId: number, selector: string): Promise<boolean> {
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  await setCrawlOverlayHidden(tabId, true);
  try {
    await new Promise((r) => setTimeout(r, 400));
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        el.scrollIntoView({ block: "center", inline: "center" });
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      },
      args: [selector],
    });
    const coords = injection?.result;
    if (!coords) return false;

    await showClickIndicator(tabId, coords.x, coords.y);

    const base = { x: coords.x, y: coords.y, button: "left", clickCount: 1, modifiers: 0 };
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { ...base, type: "mouseMoved", buttons: 0 });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { ...base, type: "mousePressed", buttons: 1 });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { ...base, type: "mouseReleased", buttons: 0 });
    return true;
  } finally {
    await setCrawlOverlayHidden(tabId, false);
    await chrome.debugger.detach(target).catch(() => {});
  }
}

/**
 * CDP 输入与密码管理器在最小化窗口下不工作：临时恢复为 normal，返回还原函数。
 */
export async function ensureTabWindowVisible(tabId: number): Promise<() => Promise<void>> {
  const noop = async () => {};
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.windowId) return noop;
    const win = await chrome.windows.get(tab.windowId);
    if (win.state !== "minimized") return noop;
    await chrome.windows.update(tab.windowId, { state: "normal" });
    return async () => {
      await chrome.windows.update(tab.windowId, { state: "minimized" }).catch(() => {});
    };
  } catch {
    return noop;
  }
}
