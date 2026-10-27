import { WS_URL } from "../shared/constants";
import type { WorkflowConfig } from "../workflow";
import { bindKeepAliveHooks, startKeepAlive, tickActiveKeepAlive } from "./keepAlive";
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

function send(msg: Record<string, unknown>): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

bindTaskQueueSend(send);

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
      send({ type: "heartbeat", role: "extension", ts: Date.now() });
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
    url: WS_URL,
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
    socket = new WebSocket(WS_URL);
  } catch (err) {
    console.warn("[crawl-ext] ws connect error", err);
    scheduleReconnect();
    return;
  }

  socket.addEventListener("open", () => {
    console.log("[crawl-ext] connected", WS_URL);
    send({ type: "hello", role: "extension" });
    startHeartbeat();
    void tickActiveKeepAlive();
  });

  socket.addEventListener("message", (ev) => {
    let msg: {
      type?: string;
      taskId?: string;
      config?: WorkflowConfig;
      priority?: number;
    };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }

    if (msg.type === "ping") {
      send({ type: "hello", role: "extension" });
      return;
    }

    if (msg.type === "cancel_task") {
      cancelTask(msg.taskId);
      void tickActiveKeepAlive();
      return;
    }

    if (msg.type === "reload_extension") {
      void requestReloadExtension(msg.taskId || "", send);
      return;
    }

    if (msg.type === "start_task") {
      enqueueTask(msg.taskId || "", msg.config || {}, msg.priority);
      void tickActiveKeepAlive();
    }
  });

  socket.addEventListener("close", () => {
    console.warn("[crawl-ext] ws closed");
    stopHeartbeat();
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
