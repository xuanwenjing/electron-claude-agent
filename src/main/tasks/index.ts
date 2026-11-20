import { loadBotRuntime } from "../agent/botPackage";
import { authSession } from "../auth";
import { startCrawl } from "../ipc/crawl";
import { onPushMessage } from "../push";
import { getClientTask, listActiveTasks, workflowOf, type ClientTask } from "./clientTask";
import { scheduledAtIso } from "./cron";
import { publishTaskResult, createTaskInstance } from "./report";
import { createTaskScheduler } from "./schedule";

const scheduler = createTaskScheduler({
  client: {
    listActive: listActiveTasks,
    get: getClientTask,
  },
  start: (task, date) => {
    void runScheduledTask(task, date);
  },
  log: (message) => console.log(`[tasks] ${message}`),
});

/** 到点后先创建执行实例，再取 Bot。签名下载地址会过期，不能在载入定时表时就组装。 */
async function runScheduledTask(task: ClientTask, date: Date): Promise<void> {
  const label = task.client_task_code;
  try {
    const instanceCode = await createTaskInstance(label, scheduledAtIso(date));
    const config = await workflowOf(task, loadBotRuntime, instanceCode);
    const result = await startCrawl(config, instanceCode, {
      checkBinding: true,
      businessType: task.business_type,
      clientTaskCode: task.client_task_code,
    });
    if (!result.ok) console.error(`[tasks] ${instanceCode} 未执行：${result.error ?? "失败"}`);
    if (!result.report) return;
    const url = await publishTaskResult(result.report);
    console.log(`[tasks] ${instanceCode} 已上报 ${url}`);
  } catch (error) {
    console.error(`[tasks] ${label} 执行失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

let listening = false;

/** 有令牌和门店时装入启用任务；退出或未选门店时清空定时表。 */
export function syncClientTasks(): void {
  if (!listening) {
    onPushMessage((event) => scheduler.onPush(event));
    listening = true;
  }
  try {
    const context = authSession.getRequestContext();
    scheduler.sync(context.token, context.outletCode);
  } catch (error) {
    console.error("[tasks] 同步任务失败", error);
  }
}

export function stopClientTasks(): void {
  scheduler.stop();
}
