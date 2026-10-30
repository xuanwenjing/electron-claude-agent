import type { RunAgentParams } from "../../../../src/shared/bridgeProtocol";
import { pushCollected, resolveEvent } from "../collect/collector";
import type { Collector, EmitFn, RunAgentStepParam, WorkflowItem } from "../types";
import type { CancelToken } from "../util";
import { TaskCancelledError, getDeepValue, isWholeExpr, resolveMaybeExpr, safeEval } from "../util";
import { assertVarName, setVariable } from "../variables";

/** 由 background/bridge 注入：把请求发给客户端并等待模型结果 */
export type AgentRunner = (
  req: { taskId?: string; params: RunAgentParams },
  token?: CancelToken | null,
) => Promise<string>;

let runner: AgentRunner | null = null;

export function bindAgentRunner(fn: AgentRunner): void {
  runner = fn;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? "";
}

/** 提示词模板：${expr} 嵌入时对象按 JSON 展开（resolveMaybeExpr 会变成 [object Object]） */
function renderPrompt(variables: Record<string, unknown>, value: unknown): string {
  if (typeof value !== "string") return stringify(getDeepValue(variables, value));
  const trimmed = value.trim();
  if (isWholeExpr(trimmed)) return stringify(safeEval(variables, trimmed));
  return value.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    try {
      return stringify(safeEval(variables, `\${${expr}}`));
    } catch {
      return "";
    }
  });
}

function parseJsonOutput(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`run_agent 输出不是合法 JSON: ${body.slice(0, 200)}`);
  }
}

type RunCtx = { taskId?: string; token?: CancelToken | null };

function buildRequest(params: RunAgentStepParam, vars: Record<string, unknown>): RunAgentParams {
  const skills = (params.skills ?? []).map((s) => ({ url: renderPrompt(vars, s?.url), version: String(s?.version ?? "") }));
  return {
    prompt: renderPrompt(vars, params.prompt),
    systemPrompt: params.system_prompt ? renderPrompt(vars, params.system_prompt) : undefined,
    model: params.model || undefined,
    skills: skills.length ? skills : undefined,
    timeoutMs: params.timeout,
  };
}

async function runOnce(params: RunAgentStepParam, request: RunAgentParams, ctx: RunCtx): Promise<unknown> {
  const text = await runner!({ taskId: ctx.taskId, params: request }, ctx.token);
  return params.output_format === "json" ? parseJsonOutput(text) : text;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 批量模式：list 每项渲染一次 prompt，最多 concurrency 个同时运行，结果按 list 顺序组成数组。
 * 失败：默认整步失败并中止其它项；allow_exception 时失败项为 null，错误写入 ${save_as}_errors。
 */
async function runBatch(
  collector: Collector,
  workflowItem: WorkflowItem,
  params: RunAgentStepParam,
  emit: EmitFn,
  ctx: RunCtx,
): Promise<unknown[]> {
  const vars = collector.variables;
  const listValue = resolveMaybeExpr(vars, workflowItem.list);
  if (listValue != null && !Array.isArray(listValue)) {
    throw new Error(`[run_agent] list 不是数组: ${String(workflowItem.list)}`);
  }
  const items = Array.isArray(listValue) ? [...listValue] : [];
  const itemVar = workflowItem.item_var ? assertVarName(workflowItem.item_var, "item_var") : "_item";
  const indexVar = workflowItem.index_var ? assertVarName(workflowItem.index_var, "index_var") : "_index";
  const concurrency = Math.min(workflowItem.concurrency ?? 1, Math.max(1, items.length));
  const tolerant = !!workflowItem.allow_exception;

  const results: unknown[] = new Array(items.length).fill(null);
  const errors: { index: number; error: string }[] = [];
  let stopped = false;
  const batchToken: CancelToken = {
    get cancelled() {
      return stopped || !!ctx.token?.cancelled;
    },
    cancel: () => {
      stopped = true;
    },
  };

  emit(`run_agent 批量开始：共 ${items.length} 项，并发 ${concurrency}（${indexVar} / ${itemVar}）`);
  let next = 0;
  let firstError: { index: number; error: unknown } | null = null;
  const worker = async () => {
    while (!batchToken.cancelled && next < items.length) {
      const i = next++;
      try {
        const request = buildRequest(params, { ...vars, [indexVar]: i, [itemVar]: items[i] });
        results[i] = await runOnce(params, request, { taskId: ctx.taskId, token: batchToken });
        emit(`run_agent [${i + 1}/${items.length}] 完成: ${stringify(results[i]).slice(0, 120)}`);
      } catch (err) {
        if (ctx.token?.cancelled) throw err;
        if (!tolerant) {
          if (!stopped) firstError = { index: i, error: err };
          batchToken.cancel();
          return;
        }
        errors.push({ index: i, error: errorText(err) });
        emit(`run_agent [${i + 1}/${items.length}] 失败（allow_exception，记为 null）: ${errorText(err)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  if (ctx.token?.cancelled) throw new TaskCancelledError();
  if (firstError) {
    const { index, error } = firstError;
    throw new Error(`run_agent 批量第 ${index + 1}/${items.length} 项失败，已中止其它项: ${errorText(error)}`);
  }

  errors.sort((a, b) => a.index - b.index);
  if (errors.length) {
    if (workflowItem.save_as) {
      setVariable(collector, `${workflowItem.save_as}_errors`, errors, emit, "run_agent 批量失败项");
    } else {
      emit(`run_agent 批量有 ${errors.length} 项失败（未配置 save_as，错误不写入变量）`);
    }
  }
  if (workflowItem.need_collect) {
    const event = resolveEvent(collector, workflowItem, "run_agent");
    for (const result of results) if (result !== null) pushCollected(collector, event, result);
  }
  emit(`run_agent 批量完成：成功 ${items.length - errors.length}，失败 ${errors.length}`);
  return results;
}

/** 返回模型结果（批量模式为数组），由步骤的 save_as 写入变量；need_collect 时追加到 collected[event] */
export async function handleRunAgent(
  collector: Collector,
  workflowItem: WorkflowItem,
  emit: EmitFn,
  ctx: RunCtx,
): Promise<unknown> {
  const params = workflowItem.run_agent_params;
  if (!params || params.prompt == null || params.prompt === "") {
    throw new Error("run_agent 需要 run_agent_params.prompt");
  }
  if ("skill_url" in params) throw new Error("run_agent_params.skill_url 已不再支持：改用 skills: [{url, version}]");
  if (params.skills !== undefined && !Array.isArray(params.skills)) {
    throw new Error("run_agent_params.skills 必须是数组 [{url, version}]");
  }
  if (!runner) throw new Error("run_agent 未就绪：客户端通道未初始化");

  const skills = params.skills ?? [];
  emit(
    `run_agent 开始` +
      `${params.model ? `，模型 ${params.model}` : ""}` +
      `${skills.length ? `，Skill ${skills.map((s) => `${s?.url}@${s?.version}`).join(", ")}` : ""}`,
  );
  if (workflowItem.list !== undefined) return runBatch(collector, workflowItem, params, emit, ctx);

  const result = await runOnce(params, buildRequest(params, collector.variables), ctx);
  if (workflowItem.need_collect) {
    pushCollected(collector, resolveEvent(collector, workflowItem, "run_agent"), result);
  }
  emit(`run_agent 完成: ${stringify(result).slice(0, 200)}`);
  return result;
}
