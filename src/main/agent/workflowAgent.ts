import fs from "node:fs";
import path from "node:path";

import type { RunAgentParams } from "../../shared/bridgeProtocol";
import { ensureWorkspaceDir } from "../paths";
import { runAgent } from "./runAgent";
import { installSkills } from "./skillPackage";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const LOG_MAX = 300;
const RUNS_DIR = "agent-runs";
/** 不属于任何任务的 run_agent 放这里，跑完即删 */
const NO_TASK_DIR = "_no-task";
const ABORT_CANCELLED = "cancelled";
const ABORT_TIMEOUT = "timeout";
/** 客户端同时运行的 Agent 上限（所有任务合计），超出排队；每个 Agent 是一个 Claude CLI + Python 进程 */
const MAX_AGENT_CONCURRENCY = 4;

let activeAgents = 0;
const slotWaiters: Array<() => void> = [];

/** 拿到运行名额；排队中被取消则抛错 */
function acquireSlot(signal: AbortSignal, log: (msg: string) => void): Promise<void> {
  if (activeAgents < MAX_AGENT_CONCURRENCY) {
    activeAgents++;
    return Promise.resolve();
  }
  log(`run_agent 排队中：客户端已有 ${activeAgents}/${MAX_AGENT_CONCURRENCY} 个 Agent 在运行`);
  return new Promise((resolve, reject) => {
    const grant = () => {
      signal.removeEventListener("abort", onAbort);
      activeAgents++;
      resolve();
    };
    const onAbort = () => {
      const i = slotWaiters.indexOf(grant);
      if (i !== -1) slotWaiters.splice(i, 1);
      reject(new Error("run_agent 已取消"));
    };
    slotWaiters.push(grant);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function releaseSlot(): void {
  activeAgents--;
  slotWaiters.shift()?.();
}

/** taskId → 该任务进行中的 run（requestId → 结果），任务结束时等它们退出再删目录 */
const tasks = new Map<string, Map<string, Promise<string>>>();
/** requestId → 进行中的 run_agent，用于取消 */
const running = new Map<string, AbortController>();
let staleRunsRemoved = false;

function clip(text: string): string {
  return text.length > LOG_MAX ? `${text.slice(0, LOG_MAX)}…` : text;
}

function safeName(id: string): string {
  return id.replace(/[^\w-]/g, "_").slice(0, 64) || "_";
}

function runsRoot(): string {
  return path.join(ensureWorkspaceDir(), RUNS_DIR);
}

function taskDirOf(taskId: string): string {
  return path.join(runsRoot(), safeName(taskId));
}

/** 上次进程遗留（崩溃 / 强退）的工作空间，本进程首次运行时整体清掉 */
function removeStaleRuns(): void {
  if (staleRunsRemoved) return;
  staleRunsRemoved = true;
  fs.rmSync(runsRoot(), { recursive: true, force: true });
}

function taskRunsOf(taskId: string): Map<string, Promise<string>> {
  let runs = tasks.get(taskId);
  if (!runs) {
    runs = new Map();
    tasks.set(taskId, runs);
  }
  return runs;
}

async function execute(
  requestId: string,
  params: RunAgentParams,
  workDir: string,
  log: (msg: string) => void,
): Promise<string> {
  const abortController = new AbortController();
  running.set(requestId, abortController);
  try {
    await acquireSlot(abortController.signal, log);
  } catch (err) {
    running.delete(requestId);
    throw err;
  }
  const timeoutMs = params.timeoutMs && params.timeoutMs > 0 ? params.timeoutMs : DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => abortController.abort(ABORT_TIMEOUT), timeoutMs);
  try {
    const pluginDirs = params.skills?.length ? [await installSkills(params.skills, workDir, log)] : [];
    return await runAgent({
      prompt: params.prompt,
      model: params.model,
      systemPrompt: params.systemPrompt,
      pluginDirs,
      workDir,
      abortController,
      onEvent: (event) => {
        if (event.kind === "assistant" || event.kind === "tool" || event.kind === "error") {
          log(`[agent] ${clip(event.text)}`);
        }
      },
    });
  } catch (err) {
    const reason = abortController.signal.reason;
    if (reason === ABORT_CANCELLED) throw new Error("run_agent 已取消");
    if (reason === ABORT_TIMEOUT) throw new Error(`run_agent 超时（${timeoutMs / 1000}s）`);
    throw err;
  } finally {
    clearTimeout(timer);
    running.delete(requestId);
    releaseSlot();
  }
}

/**
 * workflow run_agent 步骤：在独立工作空间 agent-runs/<taskId>/<requestId>/ 里安装 Skill、运行大模型，返回最终文本。
 * 工作空间在任务结束（endWorkflowTask）时统一删除。
 */
export async function runWorkflowAgent(
  requestId: string,
  taskId: string | undefined,
  params: RunAgentParams,
  log: (msg: string) => void,
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error("客户端未配置 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN");
  }
  removeStaleRuns();
  const taskRuns = taskId ? taskRunsOf(taskId) : undefined;
  const parentDir = taskId ? taskDirOf(taskId) : path.join(runsRoot(), NO_TASK_DIR);
  const workDir = path.join(parentDir, safeName(requestId));
  fs.mkdirSync(workDir, { recursive: true });
  log(`run_agent 工作空间: ${workDir}`);

  const run = execute(requestId, params, workDir, log);
  taskRuns?.set(requestId, run);
  try {
    return await run;
  } finally {
    taskRuns?.delete(requestId);
    if (!taskId) await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** 任务结束：中止该任务还在跑的 Agent，等它们退出后删掉本任务所有 Agent 工作空间 */
export async function endWorkflowTask(taskId: string): Promise<void> {
  const taskRuns = tasks.get(taskId);
  tasks.delete(taskId);
  if (taskRuns) {
    for (const requestId of [...taskRuns.keys()]) cancelWorkflowAgent(requestId);
    await Promise.allSettled(taskRuns.values());
  }
  await fs.promises.rm(taskDirOf(taskId), { recursive: true, force: true }).catch(() => {});
}

export function cancelWorkflowAgent(requestId: string): void {
  const controller = running.get(requestId);
  if (!controller) return;
  running.delete(requestId);
  controller.abort(ABORT_CANCELLED);
}

export function cancelAllWorkflowAgents(): void {
  for (const id of [...running.keys()]) cancelWorkflowAgent(id);
}
