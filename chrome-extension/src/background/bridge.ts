import {
  BRIDGE_WS_URL,
  EXTENSION_ROLE,
  ToClient,
  ToExtension,
  type ToClientMessage,
  type ToExtensionMessage,
} from "../../../src/shared/bridgeProtocol";
import { TaskCancelledError, bindAgentRunner, type WorkflowConfig } from "../workflow";
import { bindKeepAliveHooks, startKeepAlive, tickActiveKeepAlive } from "./keepAlive";
import { minimizeBrowserWindows } from "./minimizeBrowser";
import { isExtensionReloading, requestReloadExtension } from "./reloadExtension";
import {
  bindTaskQueueSend,
  cancelTask,
  clearQueue,
  enqueueTask,
  getQueueStatus,
} from "./taskQueue";

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
/** 已连接时主动发心跳，降低 SW 因「无活动」被挂起的概率 */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

bindKeepAliveHooks({
  ensureConnect: () => connect(),
  isBusy: () => {
    const q = getQueueStatus();
    return q.running || q.pending > 0;
  },
});

function send(msg: ToClientMessage): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

bindTaskQueueSend(send);

/** run_agent：requestId → 等待客户端回复 */
const pendingAgents = new Map<string, { resolve: (text: string) => void; reject: (err: Error) => void }>();

bindAgentRunner(({ taskId, params }, token) => {
  return new Promise<string>((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reject(new Error("客户端未连接，无法运行 run_agent"));
      return;
    }
    const requestId = crypto.randomUUID();
    const poll = setInterval(() => {
      if (!token?.cancelled) return;
      send({ type: ToClient.CancelAgent, requestId });
      done();
      reject(new TaskCancelledError());
    }, 500);
    const done = () => {
      clearInterval(poll);
      pendingAgents.delete(requestId);
    };
    pendingAgents.set(requestId, {
      resolve: (text) => {
        done();
        resolve(text);
      },
      reject: (err) => {
        done();
        reject(err);
      },
    });
    send({ type: ToClient.RunAgent, requestId, taskId, params });
  });
});

function rejectPendingAgents(reason: string): void {
  for (const pending of [...pendingAgents.values()]) pending.reject(new Error(reason));
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      send({ type: ToClient.Heartbeat, role: EXTENSION_ROLE, ts: Date.now() });
    }
  }, 20000);
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 2000);
}

export function getBridgeStatus(): {
  connected: boolean;
  url: string;
  queue: ReturnType<typeof getQueueStatus>;
} {
  return {
    connected: !!(socket && socket.readyState === WebSocket.OPEN),
    url: BRIDGE_WS_URL,
    queue: getQueueStatus(),
  };
}

export function reconnectBridge(): void {
  clearQueue("扩展重连，任务已取消");
  stopHeartbeat();
  socket?.close();
  socket = null;
  connect();
}

export function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    socket = new WebSocket(BRIDGE_WS_URL);
  } catch (err) {
    console.warn("[crawl-ext] ws connect error", err);
    scheduleReconnect();
    return;
  }

  socket.addEventListener("open", () => {
    console.log("[crawl-ext] connected", BRIDGE_WS_URL);
    send({ type: ToClient.Hello, role: EXTENSION_ROLE });
    startHeartbeat();
    void tickActiveKeepAlive();
  });

  socket.addEventListener("message", (ev) => {
    let msg: ToExtensionMessage;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }

    if (msg.type === ToExtension.Ping) {
      send({ type: ToClient.Hello, role: EXTENSION_ROLE });
      return;
    }

    if (msg.type === ToExtension.CancelTask) {
      cancelTask(msg.taskId);
      void tickActiveKeepAlive();
      return;
    }

    if (msg.type === ToExtension.ReloadExtension) {
      void requestReloadExtension(msg.taskId || "", send);
      return;
    }

    if (msg.type === ToExtension.RunAgentResult) {
      const pending = pendingAgents.get(msg.requestId);
      if (!pending) return;
      if (msg.ok) pending.resolve(msg.result ?? "");
      else pending.reject(new Error(msg.error || "run_agent 失败"));
      return;
    }

    if (msg.type === ToExtension.MinimizeBrowser) {
      void minimizeBrowserWindows();
      return;
    }

    if (msg.type === ToExtension.StartTask) {
      enqueueTask(msg.taskId || "", (msg.config || {}) as WorkflowConfig, msg.priority);
      void tickActiveKeepAlive();
    }
  });

  socket.addEventListener("close", () => {
    console.warn("[crawl-ext] ws closed");
    stopHeartbeat();
    rejectPendingAgents("客户端连接已断开，run_agent 中断");
    if (!isExtensionReloading()) {
      clearQueue("连接已断开，任务已取消");
    }
    socket = null;
    // setTimeout 在 SW 即将休眠时可能丢；alarm 会兜底再连
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    socket?.close();
  });
}

/** SW 启动时调用：连 WS + 挂周期唤醒 */
export async function initBridge(): Promise<void> {
  connect();
  await startKeepAlive();
}
