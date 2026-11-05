import type { TaskResultMessage } from "../../shared/bridgeProtocol";
import type { CrawlLogEntry } from "./resultFile";

export type CrawlTask = {
  taskId: string;
  status: "connecting" | "running" | "finishing";
  config: unknown;
  logs: CrawlLogEntry[];
  onResult?: (result: TaskResultMessage) => void;
};

/** IPC、bridge 和更新检查共用的唯一任务记录。 */
export class CrawlTaskManager {
  private readonly tasks = new Map<string, CrawlTask>();

  create(task: Omit<CrawlTask, "status">): CrawlTask {
    if (this.tasks.has(task.taskId))
      throw new Error(`任务已存在: ${task.taskId}`);
    const entry: CrawlTask = { ...task, status: "connecting" };
    this.tasks.set(task.taskId, entry);
    return entry;
  }
  get(taskId: string): CrawlTask | undefined {
    return this.tasks.get(taskId);
  }
  hasActive(): boolean {
    return this.tasks.size > 0;
  }
  isRunning(taskId: string): boolean {
    return this.tasks.get(taskId)?.status === "running";
  }
  list(): CrawlTask[] {
    return [...this.tasks.values()];
  }
  take(taskId: string): CrawlTask | undefined {
    const task = this.tasks.get(taskId);
    this.tasks.delete(taskId);
    return task;
  }
  clear(): void {
    this.tasks.clear();
  }
}

export const crawlTasks = new CrawlTaskManager();
