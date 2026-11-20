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
  /** 回复扩展的 run_agent 请求 */
  RunAgentResult: "run_agent_result",
  Ping: "ping",
} as const;

/** 扩展 → 客户端 */
export const ToClient = {
  Hello: "hello",
  Heartbeat: "heartbeat",
  TaskProgress: "task_progress",
  TaskResult: "task_result",
  /** workflow 的 run_agent 步骤：请求客户端运行大模型 */
  RunAgent: "run_agent",
  /** 任务取消时中止进行中的 run_agent */
  CancelAgent: "cancel_agent",
} as const;

/** 任务失败错误码（task_result.errorCode / WorkflowResult.errorCode） */
export const TaskErrorCode = {
  /** platform + needLogin 校验未通过 */
  NotLoggedIn: "NOT_LOGGED_IN",
  /** 已绑定的平台门店编号与页面抓到的不一致，不再重试 */
  OutletMismatch: "OUTLET_MISMATCH",
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
  /** 目标站点在浏览器里被设为「不允许使用扩展」（task_result.blockedOrigin 为该站点） */
  SiteBlocked: "SITE_BLOCKED",
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
  | RunAgentResultMessage
  | { type: typeof ToExtension.Ping };

/** run_agent 用到的 Skill 包：远程 zip，解压后根目录即单个 skill（有 SKILL.md） */
export type RunAgentSkill = {
  url: string;
  /** 客户端进程内 url + version 相同的包只下载一次；有 sha256 时按校验值复用 */
  version: string;
  sha256?: string;
};

/** GET /client/bots/{bot_code} 里 run_agent 要用的字段 */
export type BotRuntime = {
  botCode: string;
  systemPrompt: string;
  model?: string;
  maxTokens?: number;
  skills: RunAgentSkill[];
};

export type RunAgentParams = {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  skills?: RunAgentSkill[];
  timeoutMs?: number;
  /** 单次模型回复的输出上限 */
  maxTokens?: number;
  /** 模型与工具往返的最大轮数 */
  maxTurns?: number;
};

export type RunAgentRequestMessage = {
  type: typeof ToClient.RunAgent;
  requestId: string;
  /** 所属抓取任务，模型过程日志记入该任务 */
  taskId?: string;
  /** 日志前缀，区分并行的 Agent，如批量模式的 "2/5" */
  label?: string;
  params: RunAgentParams;
};

export type RunAgentResultMessage = {
  type: typeof ToExtension.RunAgentResult;
  requestId: string;
  ok: boolean;
  /** 模型最终输出文本 */
  result?: string;
  error?: string;
};

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
  /** errorCode=SITE_BLOCKED 时：被禁用扩展的站点，如 https://me.meituan.com */
  blockedOrigin?: string;
};

export type ToClientMessage =
  | { type: typeof ToClient.Hello; role: typeof EXTENSION_ROLE }
  | { type: typeof ToClient.Heartbeat; role: typeof EXTENSION_ROLE; ts?: number }
  | TaskProgressMessage
  | TaskResultMessage
  | RunAgentRequestMessage
  | { type: typeof ToClient.CancelAgent; requestId: string };
