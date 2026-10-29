/**
 * 采集窗口蒙层：提示用户这是客户端专用窗口，拦截用户鼠标操作。
 * 自动化不受影响：content 的 el.click() 不经过命中测试；CDP 真实点击前 background 会临时隐藏蒙层。
 * 调试用：点击右下角 40×40 区域关闭当前页面的蒙层（不在界面上提示），刷新或跳转后重新出现。
 */
import { CRAWL_OVERLAY_HOST_ID, CRAWL_OVERLAY_QUERY } from "../shared/constants";

const SECRET_AREA_PX = 40;
const SECRET_CLICKS = 1;
const SECRET_WINDOW_MS = 2000;

function buildOverlay(): HTMLElement {
  const host = document.createElement("div");
  host.id = CRAWL_OVERLAY_HOST_ID;
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483646;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      .mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); display: flex;
        align-items: center; justify-content: center; cursor: not-allowed; user-select: none;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
      .card { background: rgba(255, 255, 255, 0.96); border-radius: 12px; padding: 24px 32px;
        max-width: 420px; text-align: center; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25); }
      .title { font-size: 18px; font-weight: 600; color: #0f172a; margin-bottom: 8px; }
      .desc { font-size: 14px; line-height: 1.6; color: #475569; }
    </style>
    <div class="mask">
      <div class="card">
        <div class="title">客户端专用采集窗口</div>
        <div class="desc">此窗口由客户端自动控制，用于执行采集任务。<br />请不要操作或关闭此窗口。</div>
      </div>
    </div>`;

  const clicks: number[] = [];
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  for (const type of ["mousedown", "mouseup", "dblclick", "contextmenu", "wheel"]) {
    host.addEventListener(type, swallow, { passive: false });
  }
  host.addEventListener("click", (e) => {
    swallow(e);
    const inSecretArea =
      e.clientX >= window.innerWidth - SECRET_AREA_PX && e.clientY >= window.innerHeight - SECRET_AREA_PX;
    if (!inSecretArea) {
      clicks.length = 0;
      return;
    }
    const now = Date.now();
    clicks.push(now);
    while (clicks.length && now - clicks[0] > SECRET_WINDOW_MS) clicks.shift();
    if (clicks.length >= SECRET_CLICKS) {
      host.dataset.dismissed = "1";
      host.remove();
    }
  });
  return host;
}

async function shouldShow(): Promise<boolean> {
  try {
    const res = await chrome.runtime.sendMessage({ type: CRAWL_OVERLAY_QUERY });
    return !!res?.show;
  } catch {
    return false;
  }
}

export async function mountCrawlOverlay(): Promise<void> {
  if (window.top !== window) return;
  if (!(await shouldShow())) return;

  const host = buildOverlay();
  const attach = () => {
    if (!host.isConnected && !host.dataset.dismissed) document.documentElement.appendChild(host);
  };
  attach();
  // 部分页面会重写 <html> 子节点，定期补挂
  const timer = setInterval(() => {
    if (host.dataset.dismissed) clearInterval(timer);
    else attach();
  }, 1000);
}
