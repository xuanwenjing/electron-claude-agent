import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";

import {
  BRIDGE_PORT,
  BRIDGE_WS_URL,
  EXTENSION_ROLE,
  ToClient,
  TaskErrorCode,
  ToExtension,
  type RunAgentRequestMessage,
  type RunAgentResultMessage,
  type TaskResultMessage,
  type ToClientMessage,
  type ToExtensionMessage,
} from "../../shared/bridgeProtocol";
import {
  cancelAllWorkflowAgents,
  cancelWorkflowAgent,
  endWorkflowTask,
  runWorkflowAgent,
} from "../agent/workflowAgent";

type ProgressHandler = (taskId: string, message: string) => void;
type ResultHandler = (msg: TaskResultMessage) => void;
type StatusHandler = (connected: boolean) => void;

let wss: WebSocketServer | null = null;
let extensionSocket: WebSocket | null = null;
let onProgress: ProgressHandler | null = null;
let onResult: ResultHandler | null = null;
let onStatus: StatusHandler | null = null;
/** 服务端 ping：既探活，也给扩展 SW 制造活动，降低被挂起概率 */
let pingTimer: ReturnType<typeof setInterval> | null = null;

/** 已下发、尚未收到 task_result 的任务；扩展断开时（如浏览器被关闭）统一按失败结束 */
const inflightTasks = new Set<string>();

function handleTaskResult(msg: TaskResultMessage): void {
  inflightTasks.delete(msg.taskId);
  void endWorkflowTask(msg.taskId);
  onResult?.(msg);
}

function failInflightTasks(reason: string): void {
  for (const taskId of [...inflightTasks]) {
    handleTaskResult({
      type: ToClient.TaskResult,
      taskId,
      ok: false,
      error: reason,
      errorCode: TaskErrorCode.ExtensionDisconnected,
    });
  }
}

/** run_agent 的模型过程日志记进所属任务（界面日志 / result.json） */
function emitTaskProgress(taskId: string | undefined, message: string): void {
  if (!taskId) return;
  onProgress?.(taskId, message);
}

async function handleRunAgent(socket: WebSocket, msg: RunAgentRequestMessage): Promise<void> {
  let reply: RunAgentResultMessage;
  try {
    const result = await runWorkflowAgent(msg.requestId, msg.taskId, msg.params, (m) => emitTaskProgress(msg.taskId, m));
    reply = { type: ToExtension.RunAgentResult, requestId: msg.requestId, ok: true, result };
  } catch (err) {
    reply = {
      type: ToExtension.RunAgentResult,
      requestId: msg.requestId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(reply));
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
      extensionSocket.send(JSON.stringify({ type: ToExtension.Ping } satisfies ToExtensionMessage));
    }
  }, 20000);
}

function setExtension(socket: WebSocket | null): void {
  const wasConnected = !!extensionSocket;
  extensionSocket = socket;
  if (socket) startPing();
  else {
    stopPing();
    if (wasConnected) {
      const reason = "浏览器扩展已断开连接（浏览器被关闭或扩展重载），任务中断";
      failInflightTasks(reason);
      cancelAllWorkflowAgents();
    }
  }
  if (socket) {
    for (const resolve of connectWaiters) resolve(true);
    connectWaiters.clear();
  }
  onStatus?.(!!socket);
}

const connectWaiters = new Set<(connected: boolean) => void>();

/** 等待扩展连上 bridge；超时返回 false */
export function waitForExtensionConnected(timeoutMs: number): Promise<boolean> {
  if (isExtensionConnected()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (connected: boolean) => {
      clearTimeout(timer);
      connectWaiters.delete(done);
      resolve(connected);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    connectWaiters.add(done);
  });
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
      let msg: ToClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ToClientMessage;
      } catch {
        return;
      }

      if (msg.type === ToClient.Hello && msg.role === EXTENSION_ROLE) {
        setExtension(socket);
        return;
      }
      if (msg.type === ToClient.Heartbeat && msg.role === EXTENSION_ROLE) {
        // 扩展侧心跳：确认仍是当前扩展连接即可
        if (extensionSocket !== socket) setExtension(socket);
        return;
      }
      if (msg.type === ToClient.TaskProgress) {
        onProgress?.(msg.taskId, msg.message);
        return;
      }
      if (msg.type === ToClient.TaskResult) {
        handleTaskResult(msg);
        return;
      }
      if (msg.type === ToClient.RunAgent) {
        void handleRunAgent(socket, msg);
        return;
      }
      if (msg.type === ToClient.CancelAgent) {
        cancelWorkflowAgent(msg.requestId);
      }
    });

    socket.on("close", () => {
      if (extensionSocket === socket) setExtension(null);
    });
  });
}

export function stopBridgeServer(): void {
  inflightTasks.clear();
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
  taskId: string = randomUUID(),
): { ok: true; taskId: string } | { ok: false; error: string } {
  if (!isExtensionConnected()) {
    return { ok: false, error: `浏览器扩展未连接（已尝试启动 Edge），请确认 Edge 已加载扩展（会自动连 ${BRIDGE_WS_URL}）` };
  }
  inflightTasks.add(taskId);
  const payload: ToExtensionMessage = { type: ToExtension.StartTask, taskId, config, priority };
  extensionSocket!.send(JSON.stringify(payload));
  return { ok: true, taskId };
}

/** 通知扩展清空队列并 chrome.runtime.reload()，对齐 wormhole triggerReloadPlugin */
export function reloadExtension(): { ok: true; taskId: string } | { ok: false; error: string } {
  if (!isExtensionConnected()) {
    return { ok: false, error: "Chrome 扩展未连接" };
  }
  const taskId = randomUUID();
  const payload: ToExtensionMessage = { type: ToExtension.ReloadExtension, taskId };
  extensionSocket!.send(JSON.stringify(payload));
  return { ok: true, taskId };
}

export function minimizeBrowser(): boolean {
  if (!isExtensionConnected()) return false;
  const payload: ToExtensionMessage = { type: ToExtension.MinimizeBrowser };
  extensionSocket!.send(JSON.stringify(payload));
  return true;
}

export function cancelCrawlTask(taskId?: string): { ok: true } | { ok: false; error: string } {
  if (!isExtensionConnected()) {
    return { ok: false, error: "Chrome 扩展未连接" };
  }
  const payload: ToExtensionMessage = { type: ToExtension.CancelTask, taskId };
  extensionSocket!.send(JSON.stringify(payload));
  return { ok: true };
}
