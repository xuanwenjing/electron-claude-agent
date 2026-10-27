import { ipcMain } from "electron";

import {
  BRIDGE_PORT,
  isExtensionConnected,
  reloadExtension,
  startBridgeServer,
  startCrawlTask,
} from "../crawl/bridgeServer";
import { openUrlInChrome } from "../crawl/openBrowser";
import { saveCrawlResult } from "../db";
import { flushPendingExtensionReload } from "../update/extensionUpdater";
import { sendToRenderer } from "../window";
import { toErrorMessage } from "./errors";

const XHS_HOME = "https://www.xiaohongshu.com";

export function registerCrawlIpc(): void {
  ipcMain.handle("crawl:status", () => ({
    connected: isExtensionConnected(),
    port: BRIDGE_PORT,
  }));
  ipcMain.handle("crawl:start", (_event, config: unknown) => startCrawlTask(config));
  ipcMain.handle("crawl:reloadExtension", () => reloadExtension());
  ipcMain.handle("crawl:openXiaohongshu", async () => {
    try {
      await openUrlInChrome(XHS_HOME);
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: toErrorMessage(err) };
    }
  });
}

/** 启动扩展 bridge，并把连接状态 / 任务进度 / 结果推送给渲染进程 */
export function startCrawlBridge(): void {
  startBridgeServer({
    onStatus: (connected) => {
      sendToRenderer("crawl:status", { connected, port: BRIDGE_PORT });
      if (connected) flushPendingExtensionReload();
    },
    onProgress: (taskId, message) =>
      sendToRenderer("crawl:progress", { taskId, message }),
    onResult: (msg) => {
      const saved = saveCrawlResult({
        taskId: msg.taskId,
        ok: msg.ok,
        data: msg.data,
        error: msg.error,
      });
      sendToRenderer("crawl:result", {
        taskId: msg.taskId,
        ok: msg.ok,
        error: msg.error,
        saved,
      });
    },
  });
}
