/**
 * 对齐 wormhole triggerReloadPlugin / common_runtimeReload（精简版）
 */
import { clearQueue, getQueueStatus } from "./taskQueue";

export type ReloadSendFn = (msg: Record<string, unknown>) => void;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let reloading = false;

export function isExtensionReloading(): boolean {
  return reloading;
}

export async function requestReloadExtension(
  taskId: string,
  send: ReloadSendFn,
): Promise<void> {
  if (reloading) {
    send({
      type: "task_result",
      taskId,
      ok: false,
      error: "插件正在重载中",
    });
    return;
  }
  reloading = true;

  try {
    send({
      type: "task_progress",
      taskId,
      message: "准备重载插件：取消排队与执行中任务…",
    });

    // 清空排队、取消当前任务（对齐 batchTaskManager.reset）
    clearQueue("插件重载中");

    // 等当前 execute 收尾（最多 5s）
    const deadline = Date.now() + 5000;
    while (getQueueStatus().running && Date.now() < deadline) {
      await sleep(100);
    }

    send({
      type: "task_progress",
      taskId,
      message: "即将 chrome.runtime.reload()",
    });
    send({
      type: "task_result",
      taskId,
      ok: true,
      data: { action: "reload_extension" },
      error: null,
    });

    // 给 WS 一点时间把 result 刷出去
    await sleep(500);

    setTimeout(() => {
      try {
        chrome.runtime.reload();
      } catch (err) {
        console.error("[crawl-ext] runtime.reload failed", err);
        reloading = false;
      }
    }, 100);
  } catch (err) {
    reloading = false;
    send({
      type: "task_result",
      taskId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
