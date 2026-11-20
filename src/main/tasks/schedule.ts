import type { PushEvent } from "../push/channel";
import { cronMatches, zonedTime } from "./cron";
import type { ClientTask } from "./clientTask";

export type TaskClient = {
  listActive: (outletCode: string) => Promise<ClientTask[]>;
  get: (code: string) => Promise<ClientTask | null>;
};

type PushContent = { event?: unknown; client_task_code?: unknown };

function contentOf(event: PushEvent): PushContent | null {
  const content = event.content;
  if (!content || typeof content !== "object") return null;
  return content as PushContent;
}

function minuteKey(date: Date, timeZone: string): string {
  const time = zonedTime(date, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${time.year}-${pad(time.month)}-${pad(time.day)} ${pad(time.hour)}:${pad(time.minute)}`;
}

/**
 * 登录后保住当前门店的启用任务，只按 cron_expr 到点执行。
 * 推送的 config.reset 重新拉取当前门店的全部任务；config.updated 查出详情后替换这一条，包含新的 cron。
 */
export function createTaskScheduler(options: {
  client: TaskClient;
  start: (task: ClientTask, date: Date) => void;
  now?: () => Date;
  log?: (message: string) => void;
  /** 测试时不启动定时器，改为手动 tick */
  armed?: boolean;
}): {
  sync: (token?: string, outletCode?: string) => void;
  onPush: (event: PushEvent) => void;
  tick: (date?: Date) => void;
  stop: () => void;
  tasks: () => ClientTask[];
} {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  let tasks = new Map<string, ClientTask>();
  let outlet = "";
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const lastFired = new Map<string, string>();

  const replace = (list: ClientTask[]) => {
    tasks = new Map(list.map((task) => [task.client_task_code, task]));
  };

  const reload = async () => {
    const current = outlet;
    const gen = ++generation;
    try {
      const list = await options.client.listActive(current);
      if (gen !== generation || current !== outlet) return;
      replace(list.filter((task) => task.status === "ACTIVE" && task.outlet_codes.includes(current)));
      log(`已载入 ${tasks.size} 个任务`);
    } catch (error) {
      log(`任务列表失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const refreshOne = async (code: string) => {
    const current = outlet;
    let task: ClientTask | null;
    try {
      task = await options.client.get(code);
    } catch (error) {
      log(`任务 ${code} 查询失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (current !== outlet) return;
    if (!task || task.status !== "ACTIVE" || !task.outlet_codes.includes(current)) {
      tasks.delete(code);
      log(`任务 ${code} 已停用或不属于当前门店`);
      return;
    }
    tasks.set(code, task);
    log(`已更新任务 ${code}，cron ${task.cron_expr}`);
  };

  return {
    tasks: () => [...tasks.values()],
    stop: () => {
      generation++;
      outlet = "";
      tasks = new Map();
      lastFired.clear();
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    sync: (token?: string, outletCode?: string) => {
      if (!token || !outletCode) {
        if (outlet) log("已停止任务调度");
        generation++;
        outlet = "";
        tasks = new Map();
        lastFired.clear();
        if (timer) clearInterval(timer);
        timer = undefined;
        return;
      }
      if (outlet !== outletCode) {
        tasks = new Map();
        lastFired.clear();
      }
      outlet = outletCode;
      if (options.armed !== false && !timer) {
        timer = setInterval(() => thisTick(), 15_000);
        timer.unref?.();
      }
      void reload();
    },
    onPush: (event) => {
      if (!outlet || event.event !== "message") return;
      const content = contentOf(event);
      if (!content) return;
      if (content.event === "config.reset") {
        log("任务配置重置，重新载入任务列表");
        void reload();
        return;
      }
      if (content.event !== "config.updated" || typeof content.client_task_code !== "string") return;
      void refreshOne(content.client_task_code);
    },
    tick: (date?: Date) => thisTick(date),
  };

  function thisTick(date = now()): void {
    if (!outlet) return;
    for (const task of tasks.values()) {
      let zone = task.timezone || "Asia/Shanghai";
      try {
        zonedTime(date, zone);
      } catch {
        zone = "Asia/Shanghai";
      }
      if (!cronMatches(task.cron_expr, date, zone)) continue;
      let key = "";
      try {
        key = minuteKey(date, zone);
      } catch {
        continue;
      }
      if (lastFired.get(task.client_task_code) === key) continue;
      lastFired.set(task.client_task_code, key);
      log(`到点执行 ${task.client_task_code}`);
      options.start(task, date);
    }
  }
}
