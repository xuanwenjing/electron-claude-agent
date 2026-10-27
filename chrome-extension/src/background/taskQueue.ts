/**
 * 对齐 wormhole BatchTaskManagerStore 的精简队列：
 * - 入队 / 优先级
 * - maxTask=1 串行
 * - 任务间隔
 * - 超时看门狗
 * - 按 taskId 取消（排队中或执行中）
 */
import { TaskErrorCode, ToClient, type ToClientMessage } from "../../../src/shared/bridgeProtocol";
import {
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
  priority: number;
  enqueuedAt: number;
}

const MAX_TASK = 1;
const TASK_TIMEOUT_MS = 60 * 60 * 1000;

let queue: QueuedTask[] = [];
let runningCount = 0;
let activeTaskId: string | null = null;
let activeCancel: CancelToken | null = null;
let lastStartTime = 0;
let shiftTimer: ReturnType<typeof setTimeout> | null = null;
let taskInterval = Math.random() * 2000 + 500;
let sendFn: QueueSendFn = () => {};

export function bindTaskQueueSend(fn: QueueSendFn): void {
  sendFn = fn;
}

export function getQueueStatus(): {
  running: boolean;
  activeTaskId: string | null;
  pending: number;
} {
  return {
    running: runningCount > 0,
    activeTaskId,
    pending: queue.length,
  };
}

/** 入队并尝试调度；同 taskId 已在队列/执行中则拒绝 */
export function enqueueTask(
  taskId: string,
  config: WorkflowConfig,
  priority?: number,
): void {
  if (!taskId) {
    sendFn({ type: ToClient.TaskResult, taskId, ok: false, error: "缺少 taskId", errorCode: TaskErrorCode.InvalidTask });
    return;
  }
  if (activeTaskId === taskId || queue.some((t) => t.taskId === taskId)) {
    sendFn({
      type: ToClient.TaskResult,
      taskId,
      ok: false,
      error: "任务已在队列或执行中",
      errorCode: TaskErrorCode.InvalidTask,
    });
    return;
  }

  const item: QueuedTask = {
    taskId,
    config: config || {},
    priority: priority ?? queue.length + runningCount,
    enqueuedAt: Date.now(),
  };

  const idx = queue.findIndex((t) => t.priority > item.priority);
  if (idx === -1) queue.push(item);
  else queue.splice(idx, 0, item);

  sendFn({
    type: ToClient.TaskProgress,
    taskId,
    message: `已入队（优先级 ${item.priority}），前方等待 ${Math.max(0, queue.indexOf(item))}，执行中 ${runningCount}`,
  });

  if (priority === -1) pump(true);
  else pump(false);
}

/**
 * 取消指定任务；不传 taskId 则取消当前执行 + 清空队列
 */
export function cancelTask(taskId?: string): void {
  if (!taskId) {
    clearQueue("任务已取消");
    activeCancel?.cancel();
    return;
  }

  const qi = queue.findIndex((t) => t.taskId === taskId);
  if (qi !== -1) {
    queue.splice(qi, 1);
    sendFn({ type: ToClient.TaskResult, taskId, ok: false, error: "任务已取消", errorCode: TaskErrorCode.Cancelled });
    return;
  }

  if (activeTaskId === taskId) {
    activeCancel?.cancel();
    // 结果由 execute 结束时统一回传，避免重复 task_result
    sendFn({ type: ToClient.TaskProgress, taskId, message: "正在取消当前任务…" });
    return;
  }

  sendFn({ type: ToClient.TaskResult, taskId, ok: false, error: "任务不存在或已结束", errorCode: TaskErrorCode.InvalidTask });
}

/** 断连 / 重连：清空排队并取消当前 */
export function clearQueue(reason = "连接已断开，任务已取消"): void {
  if (shiftTimer) {
    clearTimeout(shiftTimer);
    shiftTimer = null;
  }
  const pending = queue.splice(0, queue.length);
  for (const t of pending) {
    sendFn({ type: ToClient.TaskResult, taskId: t.taskId, ok: false, error: reason, errorCode: TaskErrorCode.Cancelled });
  }
  activeCancel?.cancel();
  lastStartTime = 0;
}

function pump(immediate = false): void {
  if (queue.length === 0) return;
  if (runningCount >= MAX_TASK) return;

  if (!immediate) {
    const since = Date.now() - lastStartTime;
    if (runningCount > 0 && since < taskInterval) {
      if (!shiftTimer) {
        shiftTimer = setTimeout(() => {
          shiftTimer = null;
          pump(false);
        }, Math.max(0, taskInterval - since));
      }
      return;
    }
    // 上一任务刚结束时也略等间隔（对齐 wormhole：有间隔再启动下一个）
    if (runningCount === 0 && lastStartTime > 0 && since < taskInterval) {
      if (!shiftTimer) {
        shiftTimer = setTimeout(() => {
          shiftTimer = null;
          pump(false);
        }, Math.max(0, taskInterval - since));
      }
      return;
    }
  }

  const next = queue.shift();
  if (!next) return;

  lastStartTime = Date.now();
  taskInterval = Math.random() * 2000 + 500;
  runningCount++;
  void execute(next).finally(() => {
    runningCount--;
    if (activeTaskId === next.taskId) {
      activeTaskId = null;
      activeCancel = null;
    }
    pump(false);
  });
}

async function execute(item: QueuedTask): Promise<void> {
  const { taskId, config } = item;
  const token = createCancelToken();
  activeTaskId = taskId;
  activeCancel = token;

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
