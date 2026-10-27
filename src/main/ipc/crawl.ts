import { ipcMain } from "electron";

import { BRIDGE_PORT } from "../../shared/bridgeProtocol";
import {
  isExtensionConnected,
  reloadExtension,
  startBridgeServer,
  startCrawlTask,
} from "../crawl/bridgeServer";
import { openUrlInChrome } from "../crawl/openBrowser";
import { writeCrawlResultFile } from "../crawl/resultFile";
import { saveCrawlResult } from "../db";
import { flushPendingExtensionReload } from "../update/extensionUpdater";
import { sendToRenderer } from "../window";
import { toErrorMessage } from "./errors";

const XHS_HOME = "https://www.xiaohongshu.com";

/** 客户端直接下发（不经 Agent）的任务：taskId → config，结果落盘 workspace/crawl/<taskId>/result.json */
const directTasks = new Map<string, unknown>();

export function registerCrawlIpc(): void {
  ipcMain.handle("crawl:getStatus", () => ({
    connected: isExtensionConnected(),
    port: BRIDGE_PORT,
  }));
  ipcMain.handle("crawl:start", (_event, config: unknown) => {
    const res = startCrawlTask(config);
    if (res.ok) directTasks.set(res.taskId, config);
    return res;
  });
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
      sendToRenderer("crawl:event:status", { connected, port: BRIDGE_PORT });
      if (connected) flushPendingExtensionReload();
    },
    onProgress: (taskId, message) =>
      sendToRenderer("crawl:event:progress", { taskId, message }),
    onResult: (msg) => {
      const saved = saveCrawlResult({
        taskId: msg.taskId,
        ok: msg.ok,
        data: msg.data,
        error: msg.error,
      });
      let resultPath: string | null = null;
      if (directTasks.has(msg.taskId)) {
        const config = directTasks.get(msg.taskId);
        directTasks.delete(msg.taskId);
        try {
          resultPath = writeCrawlResultFile({ ...msg, config });
        } catch (err) {
          console.error("[crawl] 写入 result.json 失败", err);
        }
      }
      sendToRenderer("crawl:event:result", {
        taskId: msg.taskId,
        ok: msg.ok,
        error: msg.error,
        errorCode: msg.errorCode ?? null,
        saved,
        resultPath,
      });
    },
  });
}
