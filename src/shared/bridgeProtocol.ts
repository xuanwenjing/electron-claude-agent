/**
 * 客户端 ↔ Chrome 扩展 WebSocket 协议，两端共用。
 * 扩展可远程更新、客户端可能落后，改动字符串值前要考虑新旧版本互通。
 */

export const BRIDGE_PORT = 19283;
export const BRIDGE_WS_URL = `ws://127.0.0.1:${BRIDGE_PORT}`;

export const EXTENSION_ROLE = "extension";

/** 客户端 → 扩展 */
export const ToExtension = {
  StartTask: "start_task",
  CancelTask: "cancel_task",
  ReloadExtension: "reload_extension",
  /** 客户端拉起浏览器后，让扩展把浏览器窗口最小化 */
  MinimizeBrowser: "minimize_browser",
  Ping: "ping",
} as const;

/** 扩展 → 客户端 */
export const ToClient = {
  Hello: "hello",
  Heartbeat: "heartbeat",
  TaskProgress: "task_progress",
  TaskResult: "task_result",
} as const;

/** 任务失败错误码（task_result.errorCode / WorkflowResult.errorCode） */
export const TaskErrorCode = {
  /** platform + needLogin 校验未通过 */
  NotLoggedIn: "NOT_LOGGED_IN",
  /** 主动取消、断连、扩展重载导致的取消 */
  Cancelled: "CANCELLED",
  /** 超过扩展侧任务超时 */
  Timeout: "TIMEOUT",
  /** 步骤执行失败且重试用尽 */
  WorkflowFailed: "WORKFLOW_FAILED",
  /** taskId 缺失、重复或不存在 */
  InvalidTask: "INVALID_TASK",
  /** 任务标签页（或采集窗口）被关闭，且重试次数用尽 */
  TabClosed: "TAB_CLOSED",
  /** 扩展正在重载，拒绝新的重载请求 */
  ExtensionReloading: "EXTENSION_RELOADING",
  /** 客户端侧：浏览器 / 扩展未能连上 bridge，任务未下发 */
  ExtensionNotConnected: "EXTENSION_NOT_CONNECTED",
  /** 客户端侧：任务执行中扩展断开（浏览器被关闭等） */
  ExtensionDisconnected: "EXTENSION_DISCONNECTED",
  Unknown: "UNKNOWN",
} as const;

export type TaskErrorCode = (typeof TaskErrorCode)[keyof typeof TaskErrorCode];

export type ToExtensionMessage =
  | { type: typeof ToExtension.StartTask; taskId: string; config: unknown; priority?: number }
  | { type: typeof ToExtension.CancelTask; taskId?: string }
  | { type: typeof ToExtension.ReloadExtension; taskId: string }
  | { type: typeof ToExtension.MinimizeBrowser }
  | { type: typeof ToExtension.Ping };

export type TaskProgressMessage = {
  type: typeof ToClient.TaskProgress;
  taskId: string;
  message: string;
};

export type TaskResultMessage = {
  type: typeof ToClient.TaskResult;
  taskId: string;
  ok: boolean;
  data?: unknown;
  error?: string | null;
  /** ok=false 时有值 */
  errorCode?: TaskErrorCode | null;
};

export type ToClientMessage =
  | { type: typeof ToClient.Hello; role: typeof EXTENSION_ROLE }
  | { type: typeof ToClient.Heartbeat; role: typeof EXTENSION_ROLE; ts?: number }
  | TaskProgressMessage
  | TaskResultMessage;
