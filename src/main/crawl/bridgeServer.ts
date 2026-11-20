import { crawlTasks } from "./taskManager";
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
type StatusHandler = (connected: boolean) => void;

let wss: WebSocketServer | null = null;
let extensionSocket: WebSocket | null = null;
let onProgress: ProgressHandler | null = null;
let onStatus: StatusHandler | null = null;
/** 服务端 ping：既探活，也给扩展 SW 制造活动，降低被挂起概率 */
let pingTimer: ReturnType<typeof setInterval> | null = null;

function handleTaskResult(msg: TaskResultMessage, cancel = false): void {
  const task = crawlTasks.get(msg.taskId);
  if (!task || (!cancel && task.status !== "running")) return;
  task.status = "finishing";
  void endWorkflowTask(msg.taskId);
  const resolve = task.onResult;
  delete task.onResult;
  crawlTasks.take(msg.taskId);
  resolve?.(msg);
}

function failInflightTasks(reason: string): void {
  for (const { taskId, status } of crawlTasks.list()) {
    if (status !== "running") continue;
    handleTaskResult({
      type: ToClient.TaskResult,
      taskId,
      ok: false,
      error: reason,
      errorCode: TaskErrorCode.ExtensionDisconnected,
    });
  }
}

/** run_agent 的模型过程日志记进所属任务，随结果一起上报。 */
function emitTaskProgress(taskId: string | undefined, message: string): void {
  if (!taskId) return;
  onProgress?.(taskId, message);
}

async function handleRunAgent(
  socket: WebSocket,
  msg: RunAgentRequestMessage,
): Promise<void> {
  if (msg.taskId && !crawlTasks.isRunning(msg.taskId)) {
    socket.send(
      JSON.stringify({
        type: ToExtension.RunAgentResult,
        requestId: msg.requestId,
        ok: false,
        error: "任务已结束或取消",
      }),
    );
    return;
  }
  let reply: RunAgentResultMessage;
  try {
    const prefix = msg.label ? `[agent ${msg.label}]` : "[agent]";
    const result = await runWorkflowAgent(
      msg.requestId,
      msg.taskId,
      msg.params,
      (m) => emitTaskProgress(msg.taskId, `${prefix} ${m}`),
    );
    reply = {
      type: ToExtension.RunAgentResult,
      requestId: msg.requestId,
      ok: true,
      result,
    };
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
    if (
      extensionSocket &&
      extensionSocket.readyState === extensionSocket.OPEN
    ) {
      extensionSocket.send(
        JSON.stringify({ type: ToExtension.Ping } satisfies ToExtensionMessage),
      );
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
  onStatus: StatusHandler;
}): void {
  if (wss) return;
  onProgress = handlers.onProgress;
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
        if (crawlTasks.isRunning(msg.taskId))
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
  crawlTasks.clear();
  stopPing();
  extensionSocket?.close();
  extensionSocket = null;
  wss?.close();
  wss = null;
}

/** 包括准备和执行阶段，防止更新中断任务。 */
export function hasActiveCrawlTasks(): boolean {
  return crawlTasks.hasActive();
}

export function isExtensionConnected(): boolean {
  return (
    !!extensionSocket && extensionSocket.readyState === extensionSocket.OPEN
  );
}

function startCrawlTask(
  config: unknown,
  priority?: number,
  taskId: string = randomUUID(),
): { ok: true; taskId: string } | { ok: false; error: string } {
  if (!isExtensionConnected()) {
    return {
      ok: false,
      error: `浏览器扩展未连接（已尝试启动 Edge），请确认 Edge 已加载扩展（会自动连 ${BRIDGE_WS_URL}）`,
    };
  }
  const task =
    crawlTasks.get(taskId) ?? crawlTasks.create({ taskId, config, logs: [] });
  const previousStatus = task.status;
  task.status = "running";
  const payload: ToExtensionMessage = {
    type: ToExtension.StartTask,
    taskId,
    config,
    priority,
  };
  try {
    extensionSocket!.send(JSON.stringify(payload));
    return { ok: true, taskId };
  } catch (err) {
    task.status = previousStatus;
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 顺序等待扩展结果；业务层无需注册结果回调，完成后自动清理执行记录。 */
export async function runCrawlTask(
  config: unknown,
  options: {
    taskId?: string;
    prepare?: () => Promise<{ ok: true } | { ok: false; error: string }>;
  } = {},
): Promise<TaskResultMessage> {
  const taskId = options.taskId ?? randomUUID();
  const existing = crawlTasks.get(taskId);
  if (existing?.onResult || existing?.status === "running")
    throw new Error("任务正在执行");
  const task =
    existing ??
    crawlTasks.create({
      taskId,
      config,
      logs: [],
    });
  try {
    return await new Promise<TaskResultMessage>((resolve) => {
      task.onResult = resolve;
      const dispatch = (ready: { ok: true } | { ok: false; error: string }) => {
        if (crawlTasks.get(taskId) !== task || task.onResult !== resolve)
          return;
        const sent = ready.ok
          ? startCrawlTask(config, undefined, taskId)
          : ready;
        if (!sent.ok) {
          delete task.onResult;
          task.status = "finishing";
          resolve({
            type: ToClient.TaskResult,
            taskId,
            ok: false,
            error: sent.error,
            errorCode: TaskErrorCode.ExtensionNotConnected,
          });
        }
      };
      if (options.prepare) {
        void Promise.resolve()
          .then(() => {
            if (crawlTasks.get(taskId) !== task || task.onResult !== resolve)
              return { ok: false as const, error: "任务已取消" };
            return options.prepare!();
          })
          .then(dispatch, (error) =>
            dispatch({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
      } else dispatch({ ok: true });
    });
  } finally {
    if (crawlTasks.get(taskId) === task) crawlTasks.take(taskId);
  }
}

/** 通知扩展清空队列并 chrome.runtime.reload()，对齐 wormhole triggerReloadPlugin */
export function reloadExtension():
  | { ok: true; taskId: string }
  | { ok: false; error: string } {
  if (!isExtensionConnected()) {
    return { ok: false, error: "Chrome 扩展未连接" };
  }
  const taskId = randomUUID();
  const payload: ToExtensionMessage = {
    type: ToExtension.ReloadExtension,
    taskId,
  };
  extensionSocket!.send(JSON.stringify(payload));
  return { ok: true, taskId };
}

export function minimizeBrowser(): boolean {
  if (!isExtensionConnected()) return false;
  const payload: ToExtensionMessage = { type: ToExtension.MinimizeBrowser };
  extensionSocket!.send(JSON.stringify(payload));
  return true;
}

export function cancelCrawlTask(
  taskId?: string,
): { ok: true } | { ok: false; error: string } {
  // Local completion must not depend on a response from the extension.
  try {
    if (isExtensionConnected()) {
      extensionSocket!.send(
        JSON.stringify({ type: ToExtension.CancelTask, taskId }),
      );
    }
  } catch {
    /* Still cancel locally when the socket closes during send. */
  }
  for (const task of crawlTasks.list()) {
    if (taskId && task.taskId !== taskId) continue;
    handleTaskResult(
      {
        type: ToClient.TaskResult,
        taskId: task.taskId,
        ok: false,
        error: "任务已取消",
        errorCode: TaskErrorCode.Cancelled,
      },
      true,
    );
  }
  return { ok: true };
}

/** Cancel queued/running extension work and terminate local agents immediately. */
export function cancelAllCrawlTasks(reason: string): void {
  try {
    if (isExtensionConnected())
      extensionSocket!.send(JSON.stringify({ type: ToExtension.CancelTask }));
  } catch {
    /* Finish local tasks even if sending cancellation fails. */
  }
  cancelAllWorkflowAgents();
  for (const { taskId } of crawlTasks.list()) {
    handleTaskResult(
      {
        type: ToClient.TaskResult,
        taskId,
        ok: false,
        error: reason,
        errorCode: TaskErrorCode.Cancelled,
      },
      true,
    );
  }
}
