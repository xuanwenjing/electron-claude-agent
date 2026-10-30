import type { WorkflowConfig, WorkflowItem } from "./types";

/**
 * 任务类型：
 * - browser：第一步是 navigate，要建采集窗口 / 任务标签，串行执行
 * - non_browser：不碰浏览器，只能有 call_backend / run_agent / loop，可并行
 */
export const TaskKind = {
  Browser: "browser",
  NonBrowser: "non_browser",
} as const;

export type TaskKind = (typeof TaskKind)[keyof typeof TaskKind];

const NON_BROWSER_STEP_TYPES = new Set(["call_backend", "run_agent", "loop"]);

function assertNonBrowserSteps(items: WorkflowItem[], path: string): void {
  items.forEach((item, i) => {
    const at = `${path}${i + 1}`;
    if (!NON_BROWSER_STEP_TYPES.has(item?.type)) {
      throw new Error(
        `非浏览器任务（第一步不是 navigate）只支持 call_backend / run_agent / loop，第 ${at} 步是 ${item?.type}`,
      );
    }
    if (item.type === "loop" && Array.isArray(item.children)) assertNonBrowserSteps(item.children, `${at}.`);
  });
}

/** 判定任务类型；非浏览器任务含不支持的步骤、浏览器任务配了 max_task、max_task 不合法时抛错 */
export function classifyWorkflow(config: WorkflowConfig): TaskKind {
  const workflow = Array.isArray(config?.workflow) ? config.workflow : [];
  if (!workflow.length) throw new Error("workflow 为空");
  const hasMaxTask = config.max_task !== undefined;
  if (workflow[0]?.type === "navigate") {
    if (hasMaxTask) throw new Error("浏览器任务（第一步是 navigate）固定串行，不支持 max_task");
    return TaskKind.Browser;
  }
  if (hasMaxTask && !(Number.isInteger(config.max_task) && config.max_task! >= 1)) {
    throw new Error(`max_task 必须是 >= 1 的整数: ${String(config.max_task)}`);
  }
  assertNonBrowserSteps(workflow, "");
  return TaskKind.NonBrowser;
}
