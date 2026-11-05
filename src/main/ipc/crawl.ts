import { authSession } from "../auth";
import { crawlTasks } from "../crawl/taskManager";
import { randomUUID } from "node:crypto";
import { ipcMain, shell } from "electron";

import { BRIDGE_PORT, TaskErrorCode } from "../../shared/bridgeProtocol";
import {
  isExtensionConnected,
  cancelAllCrawlTasks,
  cancelCrawlTask,
  reloadExtension,
  startBridgeServer,
  runCrawlTask,
} from "../crawl/bridgeServer";
import {
  ensureExtensionConnected,
  openInEdge,
  restartEdgeWithSiteUnblocked,
} from "../crawl/edgeBrowser";
import { type CrawlLogEntry, writeCrawlResultFile } from "../crawl/resultFile";
import {
  flushPendingExtensionReload,
  getInstalledExtensionDir,
} from "../update/extensionUpdater";
import { sendToRenderer } from "../window";

function logTask(taskId: string, message: string): void {
  const task = crawlTasks.get(taskId);
  if (!task) return;
  task.logs.push({ at: new Date().toISOString(), message });
  sendToRenderer("crawl:event:progress", { taskId, message });
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
  ipcMain.handle("crawl:cancel", (_event, taskId: unknown) => {
    if (typeof taskId !== "string" || !taskId) return { ok: true };
    return cancelCrawlTask(taskId);
  });
  ipcMain.handle(
    "crawl:start",
    async (_event, config: unknown, suppliedTaskId?: unknown) => {
      if (!config || typeof config !== "object" || Array.isArray(config))
        return { ok: false, error: "抓取配置必须为对象" };
      const outlet = authSession.getState().outlet;
      Object.assign(config, {
        outlet_code: outlet?.outlet_code ?? "",
        outlet_name: outlet?.outlet_name ?? "",
        external_outlets: outlet?.external_outlets ?? [],
      });
      const taskId =
        typeof suppliedTaskId === "string" && suppliedTaskId
          ? suppliedTaskId
          : randomUUID();
      if (crawlTasks.get(taskId)) return { ok: false, error: "任务已存在" };
      const logs: CrawlLogEntry[] = [];
      const log = (message: string) => {
        if (!crawlTasks.get(taskId)) return;
        logs.push({ at: new Date().toISOString(), message });
        sendToRenderer("crawl:event:progress", { taskId, message });
      };

      const execute = (
        prepare: NonNullable<Parameters<typeof runCrawlTask>[1]>["prepare"],
      ) => {
        crawlTasks.create({ taskId, config, logs });
        return runCrawlTask(config, { taskId, prepare });
      };
      let result = await execute(() => ensureExtensionConnected(log));
      if (
        result.errorCode === TaskErrorCode.SiteBlocked &&
        result.blockedOrigin
      ) {
        const origin = result.blockedOrigin;
        result = await execute(() => restartEdgeWithSiteUnblocked(origin, log));
      }
      let resultPath: string | null = null;
      try {
        resultPath = writeCrawlResultFile({ ...result, config, logs });
      } catch (err) {
        console.error("[crawl] 写入 result.json 失败", err);
      }
      return { ...result, resultPath };
    },
  );
  ipcMain.handle("crawl:openUrl", async (_event, url: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url))
      return { ok: false as const, error: "只能打开 http 或 https 地址" };
    const error = await openInEdge(url);
    return error ? { ok: false as const, error } : { ok: true as const };
  });
  ipcMain.handle("crawl:reloadExtension", () => reloadExtension());
}

/** 启动扩展 bridge，并把连接状态 / 任务进度推送给渲染进程 */
export function startCrawlBridge(): void {
  startBridgeServer({
    onStatus: (connected) => {
      sendToRenderer("crawl:event:status", { connected, port: BRIDGE_PORT });
      if (connected) flushPendingExtensionReload();
    },
    onProgress: logTask,
  });
}

export function hasActiveClientCrawls(): boolean {
  return crawlTasks.hasActive();
}

export function cancelAllClientCrawls(reason: string): void {
  cancelAllCrawlTasks(reason);
}
