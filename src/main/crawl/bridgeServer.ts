import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";

export const BRIDGE_PORT = 19283;

export type BridgeOutbound =
  | { type: "start_task"; taskId: string; config: unknown; priority?: number }
  | { type: "cancel_task"; taskId?: string }
  | { type: "reload_extension"; taskId: string }
  | { type: "ping" };

export type BridgeInbound =
  | { type: "hello"; role: "extension" }
  | { type: "heartbeat"; role: "extension"; ts?: number }
  | { type: "task_progress"; taskId: string; message: string }
  | { type: "task_result"; taskId: string; ok: boolean; data?: unknown; error?: string | null };

export type CrawlTaskResult = Extract<BridgeInbound, { type: "task_result" }>;

type ProgressHandler = (taskId: string, message: string) => void;
type ResultHandler = (msg: CrawlTaskResult) => void;
type StatusHandler = (connected: boolean) => void;

export type CrawlWaitOutcome = {
  result: CrawlTaskResult;
  /** 该任务执行期间的 progress 日志（供 Agent 试配排查） */
  progress: string[];
};

type PendingWaiter = {
  resolve: (outcome: CrawlWaitOutcome) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let wss: WebSocketServer | null = null;
let extensionSocket: WebSocket | null = null;
let onProgress: ProgressHandler | null = null;
let onResult: ResultHandler | null = null;
let onStatus: StatusHandler | null = null;
/** 服务端 ping：既探活，也给扩展 SW 制造活动，降低被挂起概率 */
let pingTimer: ReturnType<typeof setInterval> | null = null;

/** Agent await_crawl：按 taskId 等待结果（含「结果先到」缓冲） */
const pendingResults = new Map<string, PendingWaiter>();
const completedResults = new Map<string, CrawlWaitOutcome>();
const progressLogs = new Map<string, string[]>();
const COMPLETED_TTL_MS = 10 * 60 * 1000;
const MAX_PROGRESS_LINES = 100;

function appendProgress(taskId: string, message: string): void {
  const list = progressLogs.get(taskId) ?? [];
  list.push(message);
  if (list.length > MAX_PROGRESS_LINES) {
    list.splice(0, list.length - MAX_PROGRESS_LINES);
  }
  progressLogs.set(taskId, list);
}

function takeProgress(taskId: string): string[] {
  const list = progressLogs.get(taskId) ?? [];
  progressLogs.delete(taskId);
  return list;
}

function settleCrawlResult(msg: CrawlTaskResult): void {
  const outcome: CrawlWaitOutcome = {
    result: msg,
    progress: takeProgress(msg.taskId),
  };
  const waiter = pendingResults.get(msg.taskId);
  if (waiter) {
    clearTimeout(waiter.timer);
    pendingResults.delete(msg.taskId);
    waiter.resolve(outcome);
    return;
  }
  completedResults.set(msg.taskId, outcome);
  setTimeout(() => {
    const cached = completedResults.get(msg.taskId);
    if (cached === outcome) completedResults.delete(msg.taskId);
  }, COMPLETED_TTL_MS);
}

function rejectAllPending(reason: string): void {
  for (const [taskId, waiter] of pendingResults) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(reason));
    pendingResults.delete(taskId);
    progressLogs.delete(taskId);
  }
}

/**
 * 等待指定抓取任务的 task_result。
 * 若结果已先到达（start 与 await 之间的竞态），立即返回缓冲值。
 */
export function waitForCrawlResult(
  taskId: string,
  timeoutMs = 120_000,
): Promise<CrawlWaitOutcome> {
  const cached = completedResults.get(taskId);
  if (cached) {
    completedResults.delete(taskId);
    return Promise.resolve(cached);
  }

  return new Promise<CrawlWaitOutcome>((resolve, reject) => {
    const prev = pendingResults.get(taskId);
    if (prev) {
      clearTimeout(prev.timer);
      prev.reject(new Error(`waitForCrawlResult 被新的等待替换: ${taskId}`));
    }
    const timer = setTimeout(() => {
      pendingResults.delete(taskId);
      progressLogs.delete(taskId);
      reject(new Error(`等待抓取结果超时（${timeoutMs}ms）: ${taskId}`));
    }, timeoutMs);
    pendingResults.set(taskId, { resolve, reject, timer });
  });
}

function stopPing(): void {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function startPing(): void {
  stopPing();
  pingTimer = setInterval(() => {
    if (extensionSocket && extensionSocket.readyState === extensionSocket.OPEN) {
      extensionSocket.send(JSON.stringify({ type: "ping" } satisfies BridgeOutbound));
    }
  }, 20000);
}

function setExtension(socket: WebSocket | null): void {
  const wasConnected = !!extensionSocket;
  extensionSocket = socket;
  if (socket) startPing();
  else {
    stopPing();
    if (wasConnected) rejectAllPending("Chrome 扩展已断开连接");
  }
  onStatus?.(!!socket);
}

export function startBridgeServer(handlers: {
  onProgress: ProgressHandler;
  onResult: ResultHandler;
  onStatus: StatusHandler;
}): void {
  if (wss) return;
  onProgress = handlers.onProgress;
  onResult = handlers.onResult;
  onStatus = handlers.onStatus;

  wss = new WebSocketServer({ host: "127.0.0.1", port: BRIDGE_PORT });
  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      let msg: BridgeInbound;
      try {
        msg = JSON.parse(String(raw)) as BridgeInbound;
      } catch {
        return;
      }

      if (msg.type === "hello" && msg.role === "extension") {
        setExtension(socket);
        return;
      }
      if (msg.type === "heartbeat" && msg.role === "extension") {
        // 扩展侧心跳：确认仍是当前扩展连接即可
        if (extensionSocket !== socket) setExtension(socket);
        return;
      }
      if (msg.type === "task_progress") {
        appendProgress(msg.taskId, msg.message);
        onProgress?.(msg.taskId, msg.message);
        return;
      }
      if (msg.type === "task_result") {
        settleCrawlResult(msg);
        onResult?.(msg);
      }
    });

    socket.on("close", () => {
      if (extensionSocket === socket) setExtension(null);
    });
  });
}

export function stopBridgeServer(): void {
  rejectAllPending("Bridge 服务已停止");
  completedResults.clear();
  progressLogs.clear();
  stopPing();
  extensionSocket?.close();
  extensionSocket = null;
  wss?.close();
  wss = null;
}

export function isExtensionConnected(): boolean {
  return !!extensionSocket && extensionSocket.readyState === extensionSocket.OPEN;
}

export function startCrawlTask(
  config: unknown,
  priority?: number,
): { ok: true; taskId: string } | { ok: false; error: string } {
  if (!isExtensionConnected()) {
    return { ok: false, error: "Chrome 扩展未连接，请先加载并打开扩展（会自动连 ws://127.0.0.1:19283）" };
  }
  const taskId = randomUUID();
  progressLogs.set(taskId, []);
  const payload: BridgeOutbound = { type: "start_task", taskId, config, priority };
  extensionSocket!.send(JSON.stringify(payload));
  return { ok: true, taskId };
}

/** 通知扩展清空队列并 chrome.runtime.reload()，对齐 wormhole triggerReloadPlugin */
export function reloadExtension(): { ok: true; taskId: string } | { ok: false; error: string } {
  if (!isExtensionConnected()) {
    return { ok: false, error: "Chrome 扩展未连接" };
  }
  const taskId = randomUUID();
  const payload: BridgeOutbound = { type: "reload_extension", taskId };
  extensionSocket!.send(JSON.stringify(payload));
  return { ok: true, taskId };
}

export function cancelCrawlTask(taskId?: string): { ok: true } | { ok: false; error: string } {
  if (!isExtensionConnected()) {
    return { ok: false, error: "Chrome 扩展未连接" };
  }
  const payload: BridgeOutbound = { type: "cancel_task", taskId };
  extensionSocket!.send(JSON.stringify(payload));
  return { ok: true };
}
