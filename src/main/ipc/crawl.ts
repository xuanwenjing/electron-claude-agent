import { authSession } from "../auth";
import { crawlTasks } from "../crawl/taskManager";
import { ipcMain, shell } from "electron";

import { BRIDGE_PORT, TaskErrorCode } from "../../shared/bridgeProtocol";
import { normalizePlatform, PLATFORM_LABELS } from "../../shared/merchant";
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
import { type CrawlLogEntry } from "../crawl/resultFile";
import {
  flushPendingExtensionReload,
  getInstalledExtensionDir,
} from "../update/extensionUpdater";
import { sendToRenderer } from "../window";

/** 定时任务启动前核对：任务平台必须已经绑定了门店编号。商家绑定采集不走这里。 */
export function scheduledOutletError(
  platform: unknown,
  outlets: Array<{ group: string; code: string }> | undefined,
): string | null {
  const name = typeof platform === "string" ? normalizePlatform(platform.trim()) : "";
  if (!name) return "任务未指定平台，无法核对门店绑定";
  const bound = (outlets ?? []).some(
    (item) => normalizePlatform(item.group) === name && item.code.trim(),
  );
  if (bound) return null;
  return `账号未绑定${PLATFORM_LABELS[name as keyof typeof PLATFORM_LABELS] ?? name}门店`;
}

function rejectedCrawl(
  taskId: string,
  error: string,
  errorCode: string,
  config: unknown,
  options?: { businessType?: string; clientTaskCode?: string },
) {
  const businessType = options?.businessType?.trim() || undefined;
  const clientTaskCode = options?.clientTaskCode?.trim() || undefined;
  return {
    ok: false as const,
    taskId,
    error,
    errorCode,
    report: {
      taskId,
      clientTaskCode,
      businessType,
      ok: false,
      error,
      errorCode,
      data: null,
      config,
      logs: [] as CrawlLogEntry[],
      savedAt: new Date().toISOString(),
    },
  };
}

function logTask(taskId: string, message: string): void {
  const task = crawlTasks.get(taskId);
  if (!task) return;
  task.logs.push({ at: new Date().toISOString(), message });
  sendToRenderer("crawl:event:progress", { taskId, message });
}

/** 用调用方传入的任务编号启动一次抓取。编号已在执行中时返回失败，跑完后可以再用同一个编号。 */
export async function startCrawl(
  config: unknown,
  taskId: string,
  options?: {
    checkBinding?: boolean;
    businessType?: string;
    clientTaskCode?: string;
  },
): Promise<{
  ok: boolean;
  taskId?: string;
  data?: unknown;
  error?: string;
  errorCode?: string | null;
  report?: {
    taskId?: string;
    clientTaskCode?: string;
    businessType?: string;
    ok: boolean;
    error: string | null;
    errorCode: string | null;
    data: unknown;
    config: unknown;
    logs: CrawlLogEntry[];
    savedAt: string;
  } | null;
}> {
  const businessType = options?.businessType?.trim() || undefined;
  const clientTaskCode = options?.clientTaskCode?.trim() || undefined;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return rejectedCrawl(taskId, "抓取配置必须为对象", TaskErrorCode.InvalidTask, config, options);
  }
  if (!taskId.trim()) {
    return rejectedCrawl(taskId, "任务编号不能为空", TaskErrorCode.InvalidTask, config, options);
  }
  const outlet = authSession.getState().outlet;
  Object.assign(config, {
    outlet_code: outlet?.outlet_code ?? "",
    outlet_name: outlet?.outlet_name ?? "",
    external_outlets: outlet?.external_outlets ?? [],
  });
  if (crawlTasks.get(taskId)) {
    return rejectedCrawl(taskId, "任务已存在", TaskErrorCode.InvalidTask, config, options);
  }
  if (options?.checkBinding) {
    const error = scheduledOutletError(
      (config as { platform?: unknown }).platform,
      outlet?.external_outlets,
    );
    if (error) return rejectedCrawl(taskId, error, TaskErrorCode.OutletMismatch, config, options);
  }
  const logs: CrawlLogEntry[] = [];
  const log = (message: string) => {
    if (!crawlTasks.get(taskId)) return;
    logs.push({ at: new Date().toISOString(), message });
    console.log("[crawl] log", message);
    sendToRenderer("crawl:event:progress", { taskId, message });
  };

  const execute = (
    prepare: NonNullable<Parameters<typeof runCrawlTask>[1]>["prepare"],
  ) => {
    crawlTasks.create({ taskId, config, logs });
    return runCrawlTask(config, { taskId, prepare });
  };
  let result = await execute(() => ensureExtensionConnected(log));
  if (result.errorCode === TaskErrorCode.SiteBlocked && result.blockedOrigin) {
    const origin = result.blockedOrigin;
    result = await execute(() => restartEdgeWithSiteUnblocked(origin, log));
  }
  return {
    ok: result.ok,
    taskId: result.taskId,
    data: result.data,
    error: result.error || undefined,
    errorCode: result.errorCode,
    report: {
      taskId: result.taskId,
      clientTaskCode,
      businessType,
      ok: result.ok,
      error: result.error ?? null,
      errorCode: result.errorCode ?? null,
      data: result.data ?? null,
      config,
      logs,
      savedAt: new Date().toISOString(),
    },
  };
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
  ipcMain.handle("crawl:start", (_event, config: unknown, taskId: unknown) => {
    if (typeof taskId !== "string") {
      return rejectedCrawl("", "任务编号不能为空", TaskErrorCode.InvalidTask, config);
    }
    return startCrawl(config, taskId);
  });
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
