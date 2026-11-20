import { z } from "zod";

import type { BotRuntime } from "../../shared/bridgeProtocol";
import { request } from "../utils/request";

const taskSchema = z.object({
  client_task_code: z.string().min(1),
  title: z.string().optional(),
  business_type: z.string().min(1),
  task_config: z.record(z.string(), z.unknown()).optional(),
  outlet_codes: z.array(z.string()).optional(),
  cron_expr: z.string().min(1),
  timezone: z.string().optional(),
  status: z.string(),
  config_revision: z.number().optional(),
});

export type ClientTask = {
  client_task_code: string;
  title: string;
  business_type: string;
  task_config: Record<string, unknown>;
  outlet_codes: string[];
  cron_expr: string;
  timezone: string;
  status: string;
  config_revision?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseClientTask(data: unknown): ClientTask {
  const parsed = taskSchema.safeParse(data);
  if (!parsed.success) {
    const code = isRecord(data) && typeof data.client_task_code === "string" ? data.client_task_code : "";
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "任务"}：${issue.message}`)
      .join("；");
    throw new Error(`任务配置无法解析${code ? ` ${code}` : ""}${detail ? `：${detail}` : ""}`);
  }
  const task = parsed.data;
  return {
    client_task_code: task.client_task_code,
    title: task.title ?? "",
    business_type: task.business_type,
    task_config: task.task_config ?? {},
    outlet_codes: task.outlet_codes ?? [],
    cron_expr: task.cron_expr,
    timezone: task.timezone || "Asia/Shanghai",
    status: task.status,
    ...(task.config_revision === undefined ? {} : { config_revision: task.config_revision }),
  };
}

/** 下发给插件前，把 task_config 里每个 run_agent 的 Bot 详情填回步骤，其余配置保持原样。 */
export async function workflowOf(
  task: ClientTask,
  loadBot: (botCode: string) => Promise<BotRuntime>,
  instanceCode?: string,
): Promise<Record<string, unknown>> {
  const config = JSON.parse(JSON.stringify(task.task_config)) as Record<string, unknown>;
  await expandAgentSteps(config.workflow, loadBot);
  if (instanceCode) {
    const variables = isRecord(config.variables) ? config.variables : {};
    config.variables = { ...variables, client_task_code: task.client_task_code, instance_code: instanceCode };
  }
  return config;
}

async function expandAgentSteps(
  steps: unknown,
  loadBot: (botCode: string) => Promise<BotRuntime>,
): Promise<void> {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!isRecord(step)) continue;
    if (step.type === "run_agent") {
      const params = isRecord(step.run_agent_params) ? step.run_agent_params : {};
      const code = (typeof params.bot_code === "string" ? params.bot_code : "").trim();
      if (!code) throw new Error("run_agent 缺少 bot_code");
      const bot = await loadBot(code);
      const { output_format, timeout, max_turns } = params;
      step.run_agent_params = {
        prompt: bot.systemPrompt,
        system_prompt: bot.systemPrompt,
        ...(bot.model ? { model: bot.model } : {}),
        ...(bot.maxTokens ? { max_tokens: bot.maxTokens } : {}),
        ...(bot.skills.length ? { skills: bot.skills } : {}),
        ...(output_format === undefined ? {} : { output_format }),
        ...(timeout === undefined ? {} : { timeout }),
        ...(max_turns === undefined ? {} : { max_turns }),
      };
    }
    if (step.children !== undefined) await expandAgentSteps(step.children, loadBot);
  }
}

function activeForOutlet(task: ClientTask, outletCode: string): boolean {
  return task.status === "ACTIVE" && task.outlet_codes.includes(outletCode);
}

export async function listActiveTasks(outletCode: string): Promise<ClientTask[]> {
  const tasks: ClientTask[] = [];
  for (let page = 1; page <= 20; page++) {
    const body = await request.request({
      url: "/admin/client_tasks",
      method: "GET",
      params: {
        current_page: page,
        page_size: 100,
        status: "ACTIVE",
        outlet_code: outletCode,
      },
    });
    if (!body || body.code !== 200) throw new Error(body?.msg || body?.message || "任务列表失败");
    const data = body.data ?? {};
    const list = Array.isArray(data.data_list) ? data.data_list : [];
    for (const item of list) {
      const task = parseClientTask(item);
      if (activeForOutlet(task, outletCode)) tasks.push(task);
    }
    if (page >= (Number(data.total_page) || 1)) break;
  }
  return tasks;
}

export async function getClientTask(code: string): Promise<ClientTask | null> {
  if (!/^[\w.-]+$/.test(code)) return null;
  const body = await request.request({
    url: `/client/tasks/${encodeURIComponent(code)}`,
    method: "GET",
  });
  if (!body || body.code !== 200) return null;
  return parseClientTask(body.data);
}
