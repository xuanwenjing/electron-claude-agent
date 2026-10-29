import { ADOPT_WAIT_MS, adoptStartupWindowAsCrawlWindow } from "../workflow";

/** 浏览器刚启动时窗口可能晚于扩展连接出现，这段时间内新建的普通窗口也最小化 */
const LATE_WINDOW_GRACE_MS = ADOPT_WAIT_MS;

function minimize(windowId?: number): void {
  if (windowId === undefined) return;
  chrome.windows.update(windowId, { state: "minimized" }).catch(() => {});
}

/** 客户端拉起浏览器后调用：启动窗口收编为采集窗口，并最小化所有普通窗口 */
export async function minimizeBrowserWindows(): Promise<void> {
  // 须在第一个 await 之前发起：紧随其后的 start_task 会等收编完成再取采集窗口
  void adoptStartupWindowAsCrawlWindow();

  const onCreated = (win: chrome.windows.Window) => {
    if (win.type === "normal") minimize(win.id);
  };
  chrome.windows.onCreated.addListener(onCreated);
  setTimeout(() => chrome.windows.onCreated.removeListener(onCreated), LATE_WINDOW_GRACE_MS);

  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  for (const win of windows) {
    if (win.state !== "minimized") minimize(win.id);
  }
}
