/**
 * 可取消等待：对齐 wormhole cancellableSleep + taskStore.isDroped
 */

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export class TaskCancelledError extends Error {
  constructor(message = "任务已取消") {
    super(message);
    this.name = "TaskCancelledError";
  }
}

export interface CancelToken {
  readonly cancelled: boolean;
  cancel: () => void;
}

export function createCancelToken(): CancelToken {
  const state = { cancelled: false };
  return {
    get cancelled() {
      return state.cancelled;
    },
    cancel() {
      state.cancelled = true;
    },
  };
}

/** 每 500ms 检查一次取消，对齐 cancellableSleep */
export async function cancellableSleep(ms: number, token?: CancelToken | null): Promise<void> {
  let i = 0;
  const total = Math.max(0, Number(ms) || 0);
  while ((!token || !token.cancelled) && i <= total) {
    const step = Math.min(500, Math.max(0, total - i));
    if (step <= 0) break;
    await sleep(step);
    i += step;
  }
  if (token?.cancelled) {
    throw new TaskCancelledError();
  }
}
