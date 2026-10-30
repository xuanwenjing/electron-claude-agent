import { randomUUID } from "node:crypto";
import { ipcMain, shell } from "electron";

import { BRIDGE_PORT, TaskErrorCode, type TaskResultMessage } from "../../shared/bridgeProtocol";
import {
  isExtensionConnected,
  reloadExtension,
  startBridgeServer,
  startCrawlTask,
} from "../crawl/bridgeServer";
import { ensureExtensionConnected, restartEdgeWithSiteUnblocked } from "../crawl/edgeBrowser";
import { openUrlInChrome } from "../crawl/openBrowser";
import { type CrawlLogEntry, writeCrawlResultFile } from "../crawl/resultFile";
import { saveCrawlResult } from "../db";
import { flushPendingExtensionReload, getInstalledExtensionDir } from "../update/extensionUpdater";
import { sendToRenderer } from "../window";
import { toErrorMessage } from "./errors";

const XHS_HOME = "https://www.xiaohongshu.com";

/** 客户端直接下发（不经 Agent）的任务：taskId → config + 抓取日志，结果落盘 workspace/crawl/<taskId>/result.json */
const directTasks = new Map<string, { config: unknown; logs: CrawlLogEntry[]; siteUnblocked?: boolean }>();

function logTask(taskId: string, message: string): void {
  directTasks.get(taskId)?.logs.push({ at: new Date().toISOString(), message });
  sendToRenderer("crawl:event:progress", { taskId, message });
}

function finishTask(msg: TaskResultMessage): void {
  const saved = saveCrawlResult({
    taskId: msg.taskId,
    ok: msg.ok,
    data: msg.data,
    error: msg.error,
  });
  let resultPath: string | null = null;
  const task = directTasks.get(msg.taskId);
  if (task) {
    directTasks.delete(msg.taskId);
    try {
      resultPath = writeCrawlResultFile({ ...msg, config: task.config, logs: task.logs });
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
}

/** 站点被禁用扩展：重启 Edge 解除后，同一 taskId 重新下发一次 */
async function retryAfterUnblockSite(msg: TaskResultMessage, origin: string, config: unknown): Promise<void> {
  const log = (message: string) => logTask(msg.taskId, `[客户端] ${message}`);
  const restarted = await restartEdgeWithSiteUnblocked(origin, log);
  const res = restarted.ok ? startCrawlTask(config, undefined, msg.taskId) : restarted;
  if (res.ok) {
    log("已重新下发任务");
    return;
  }
  log(`解除站点限制失败: ${res.error}`);
  finishTask(msg);
}

export function registerCrawlIpc(): void {
  ipcMain.handle("crawl:getStatus", () => ({
    connected: isExtensionConnected(),
    port: BRIDGE_PORT,
    extensionDir: getInstalledExtensionDir(),
  }));
  ipcMain.handle("crawl:revealExtensionDir", async () => {
    const error = await shell.openPath(getInstalledExtensionDir());
    return error ? { ok: false as const, error } : { ok: true as const };
  });
  ipcMain.handle("crawl:start", async (_event, config: unknown) => {
    const taskId = randomUUID();
    const logs: CrawlLogEntry[] = [];
    const log = (message: string) => {
      logs.push({ at: new Date().toISOString(), message });
      sendToRenderer("crawl:event:progress", { taskId, message });
    };

    const connected = await ensureExtensionConnected(log);
    const res = connected.ok
      ? startCrawlTask(config, undefined, taskId)
      : { ok: false as const, error: connected.error };
    if (res.ok) {
      directTasks.set(taskId, { config, logs });
      return res;
    }

    log(res.error);
    let resultPath: string | null = null;
    try {
      resultPath = writeCrawlResultFile({
        taskId,
        ok: false,
        error: res.error,
        errorCode: TaskErrorCode.ExtensionNotConnected,
        config,
        logs,
      });
    } catch (err) {
      console.error("[crawl] 写入 result.json 失败", err);
    }
    return { ...res, taskId, resultPath };
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
    onProgress: logTask,
    onResult: (msg) => {
      const task = directTasks.get(msg.taskId);
      if (task && !task.siteUnblocked && msg.errorCode === TaskErrorCode.SiteBlocked && msg.blockedOrigin) {
        task.siteUnblocked = true;
        void retryAfterUnblockSite(msg, msg.blockedOrigin, task.config);
        return;
      }
      finishTask(msg);
    },
  });
}
