/**
 * 对齐 wormhole BatchTaskManagerStore 的精简队列：
 * - 入队 / 优先级
 * - 按任务类型分池：浏览器任务串行（带启动间隔），非浏览器任务并行（上限取任务自己的 max_task）
 * - 超时看门狗
 * - 按 taskId 取消（排队中或执行中）
 */
import { TaskErrorCode, ToClient, type ToClientMessage } from "../../../src/shared/bridgeProtocol";
import {
  TaskKind,
  classifyWorkflow,
  createCancelToken,
  runWorkflow,
  type CancelToken,
  type WorkflowConfig,
  type WorkflowResult,
} from "../workflow";

export type QueueSendFn = (msg: ToClientMessage) => void;

interface QueuedTask {
  taskId: string;
  config: WorkflowConfig;
  kind: TaskKind;
  /** 非浏览器任务：运行中的非浏览器任务少于该值才启动 */
  maxTask: number;
  priority: number;
  enqueuedAt: number;
}

/** 浏览器任务共用一个采集窗口，固定串行 */
const BROWSER_MAX_TASK = 1;
/** 非浏览器任务未配置 max_task 时的默认值 */
const DEFAULT_NON_BROWSER_MAX_TASK = 3;
const TASK_TIMEOUT_MS = 60 * 60 * 1000;

let queue: QueuedTask[] = [];
/** 执行中的任务：taskId → 取消令牌 / 类型 */
const running = new Map<string, { token: CancelToken; kind: TaskKind }>();
/** 浏览器任务的启动间隔 */
let lastBrowserStartTime = 0;
let shiftTimer: ReturnType<typeof setTimeout> | null = null;
let taskInterval = Math.random() * 2000 + 500;
let sendFn: QueueSendFn = () => {};

export function bindTaskQueueSend(fn: QueueSendFn): void {
  sendFn = fn;
}

function runningCount(kind: TaskKind): number {
  let count = 0;
  for (const r of running.values()) if (r.kind === kind) count++;
  return count;
}

export function getQueueStatus(): {
  running: boolean;
  activeTaskIds: string[];
  pending: number;
} {
  return {
    running: running.size > 0,
    activeTaskIds: [...running.keys()],
    pending: queue.length,
  };
}

/** 入队并尝试调度；同 taskId 已在队列/执行中、或工作流不合法则拒绝 */
export function enqueueTask(
  taskId: string,
  config: WorkflowConfig,
  priority?: number,
): void {
  if (!taskId) {
    sendFn({ type: ToClient.TaskResult, taskId, ok: false, error: "缺少 taskId", errorCode: TaskErrorCode.InvalidTask });
    return;
  }
  if (running.has(taskId) || queue.some((t) => t.taskId === taskId)) {
    sendFn({
      type: ToClient.TaskResult,
      taskId,
      ok: false,
      error: "任务已在队列或执行中",
      errorCode: TaskErrorCode.InvalidTask,
    });
    return;
  }

  let kind: TaskKind;
  try {
    kind = classifyWorkflow(config || {});
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    sendFn({ type: ToClient.TaskResult, taskId, ok: false, error, errorCode: TaskErrorCode.InvalidTask });
    return;
  }

  const item: QueuedTask = {
    taskId,
    config: config || {},
    kind,
    maxTask: config?.max_task ?? DEFAULT_NON_BROWSER_MAX_TASK,
    priority: priority ?? queue.length + running.size,
    enqueuedAt: Date.now(),
  };

  const idx = queue.findIndex((t) => t.priority > item.priority);
  if (idx === -1) queue.push(item);
  else queue.splice(idx, 0, item);

  const ahead = queue.filter((t) => t.kind === kind).indexOf(item);
  const label = kind === TaskKind.Browser ? "浏览器任务" : "非浏览器任务";
  sendFn({
    type: ToClient.TaskProgress,
    taskId,
    message: `已入队（${label}，优先级 ${item.priority}），前方等待 ${Math.max(0, ahead)}，执行中 ${runningCount(kind)}`,
  });

  pump(priority === -1);
}

/**
 * 取消指定任务；不传 taskId 则取消所有执行中的任务 + 清空队列
 */
export function cancelTask(taskId?: string): void {
  if (!taskId) {
    clearQueue("任务已取消");
    return;
  }

  const qi = queue.findIndex((t) => t.taskId === taskId);
  if (qi !== -1) {
    queue.splice(qi, 1);
    sendFn({ type: ToClient.TaskResult, taskId, ok: false, error: "任务已取消", errorCode: TaskErrorCode.Cancelled });
    return;
  }

  const active = running.get(taskId);
  if (active) {
    active.token.cancel();
    // 结果由 execute 结束时统一回传，避免重复 task_result
    sendFn({ type: ToClient.TaskProgress, taskId, message: "正在取消当前任务…" });
    return;
  }

  sendFn({ type: ToClient.TaskResult, taskId, ok: false, error: "任务不存在或已结束", errorCode: TaskErrorCode.InvalidTask });
}

/** 断连 / 重连：清空排队并取消所有执行中的任务 */
export function clearQueue(reason = "连接已断开，任务已取消"): void {
  if (shiftTimer) {
    clearTimeout(shiftTimer);
    shiftTimer = null;
  }
  const pending = queue.splice(0, queue.length);
  for (const t of pending) {
    sendFn({ type: ToClient.TaskResult, taskId: t.taskId, ok: false, error: reason, errorCode: TaskErrorCode.Cancelled });
  }
  for (const { token } of running.values()) token.cancel();
  lastBrowserStartTime = 0;
}

function start(item: QueuedTask): void {
  queue.splice(queue.indexOf(item), 1);
  const token = createCancelToken();
  running.set(item.taskId, { token, kind: item.kind });
  void execute(item, token).finally(() => {
    running.delete(item.taskId);
    pump(false);
  });
}

function pump(immediate = false): void {
  // 非浏览器任务：按优先级，运行中的非浏览器任务少于自己的 max_task 就启动，不需要间隔
  for (const item of queue.filter((t) => t.kind === TaskKind.NonBrowser)) {
    if (runningCount(TaskKind.NonBrowser) < item.maxTask) start(item);
  }
  pumpBrowser(immediate);
}

function pumpBrowser(immediate: boolean): void {
  const next = queue.find((t) => t.kind === TaskKind.Browser);
  if (!next) return;
  const busy = runningCount(TaskKind.Browser);
  if (busy >= BROWSER_MAX_TASK) return;

  if (!immediate) {
    const since = Date.now() - lastBrowserStartTime;
    // 对齐 wormhole：浏览器任务之间留间隔再启动下一个
    if (lastBrowserStartTime > 0 && since < taskInterval) {
      if (!shiftTimer) {
        shiftTimer = setTimeout(() => {
          shiftTimer = null;
          pump(false);
        }, Math.max(0, taskInterval - since));
      }
      return;
    }
  }

  lastBrowserStartTime = Date.now();
  taskInterval = Math.random() * 2000 + 500;
  start(next);
}

async function execute(item: QueuedTask, token: CancelToken): Promise<void> {
  const { taskId, config } = item;

  sendFn({
    type: ToClient.TaskProgress,
    taskId,
    message: `开始执行（队列剩余 ${queue.length}）`,
  });

  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<WorkflowResult>((resolve) => {
    timeoutTimer = setTimeout(() => {
      token.cancel();
      resolve({ ok: false, error: "任务执行超时被强制结束", errorCode: TaskErrorCode.Timeout, data: null });
    }, TASK_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([
      runWorkflow(
        config,
        (message) => sendFn({ type: ToClient.TaskProgress, taskId, message }),
        token,
        taskId,
      ),
      timeoutPromise,
    ]);

    if (token.cancelled && !result.ok) {
      sendFn({
        type: ToClient.TaskResult,
        taskId,
        ok: false,
        error: result.error || "任务已取消",
        errorCode: result.errorCode ?? TaskErrorCode.Cancelled,
        data: result.data,
      });
      return;
    }

    sendFn({
      type: ToClient.TaskResult,
      taskId,
      ok: result.ok,
      data: result.data,
      error: result.error || null,
      errorCode: result.ok ? null : (result.errorCode ?? TaskErrorCode.Unknown),
      blockedOrigin: result.blockedOrigin,
    });
  } catch (err) {
    sendFn({
      type: ToClient.TaskResult,
      taskId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      errorCode: TaskErrorCode.Unknown,
    });
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }
}
