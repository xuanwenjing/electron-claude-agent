import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import {
  cancelCrawlTask,
  isExtensionConnected,
  startCrawlTask,
  waitForCrawlResult,
  type CrawlWaitOutcome,
} from "../crawl/bridgeServer";
import { listCrawlResults } from "../db";
import { ensureWorkspaceDir } from "../paths";

const SLIM_MAX_ITEMS = 50;
const SLIM_PREVIEW_CHARS = 800;

function isInsideWorkspace(workspace: string, targetPath: string): boolean {
  const abs = path.resolve(workspace, targetPath);
  const rel = path.relative(workspace, abs);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function resolveWorkspacePath(relPath: string): { ok: true; abs: string } | { ok: false; error: string } {
  const workspace = ensureWorkspaceDir();
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || path.isAbsolute(normalized)) {
    return { ok: false, error: `路径必须是工作区内相对路径: ${relPath}` };
  }
  if (!isInsideWorkspace(workspace, normalized)) {
    return { ok: false, error: `路径超出工作区: ${relPath}` };
  }
  return { ok: true, abs: path.resolve(workspace, normalized) };
}

/** 目录名：时间前缀 + taskId 短码，按名字排序即大致按新旧 */
function crawlDirName(taskId: string, at = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp =
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  const short =
    taskId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "task";
  return `${stamp}_${short}`;
}

/** 统一落到 crawl/<YYYYMMDD-HHmmss_短id>/<文件名> */
function crawlTaskWritePath(taskId: string, writePath?: string): string {
  const dir = crawlDirName(taskId);
  const raw = (writePath || "result.json").replace(/\\/g, "/").replace(/^\.\//, "");
  let base = path.posix.basename(raw) || "result.json";
  if (!base.toLowerCase().endsWith(".json")) base = `${base}.json`;
  return `crawl/${dir}/${base}`;
}

function textResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

/** 接受对象，或模型因 schema 误传的 JSON 字符串 */
function parseWorkflowConfig(
  config: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  let value: unknown = config;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (err) {
      return {
        ok: false,
        error: `config JSON 无效: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "config 必须是 JSON 对象（含 maxRetry / workflow）" };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

/** 明确 object|string，避免 z.unknown() 导致模型只传字符串 */
const workflowConfigField = z
  .union([z.record(z.string(), z.any()), z.string()])
  .describe(
    "WorkflowConfig 对象（推荐）。抓取字段：maxRetry、workflow，可选 platform（ctripEbk | ctripHotel）+ needLogin（navigate 到该平台后校验登录，未登录直接失败）。Agent 侧可选：instruction（如何处理抓取结果）、outputSchema（最终 JSON 形态）；扩展忽略后两字段，会写入 crawl/<时间_短id>/config.json。也可传同等内容的 JSON 字符串。",
  );

function previewValue(value: unknown): unknown {
  if (value == null) return null;
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    if (s.length <= SLIM_PREVIEW_CHARS) {
      try {
        return JSON.parse(s);
      } catch {
        return s;
      }
    }
    return `${s.slice(0, SLIM_PREVIEW_CHARS)}…`;
  } catch {
    return "[unserializable]";
  }
}

/**
 * 探测轮落盘用：把网络采集条目压成 method/url/responsePreview，不改扩展采集逻辑。
 * writePath 含 probe 时默认开启。
 */
function slimCrawlData(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const src = data as {
    collected?: Record<string, { type?: string; value?: unknown; content?: unknown[] }>;
    variables?: Record<string, unknown>;
  };
  const collected: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(src.collected || {})) {
    if (entry?.type === "text" || entry?.type === "dom_snapshot") {
      collected[key] = { type: entry.type, value: previewValue(entry.value) };
      continue;
    }
    if (entry?.type === "array" && Array.isArray(entry.content)) {
      collected[key] = {
        type: "array",
        content: entry.content.slice(0, SLIM_MAX_ITEMS).map((item) => {
          if (!item || typeof item !== "object") return item;
          const row = item as Record<string, unknown>;
          return {
            method: row.method || "GET",
            url: row.url ?? row.api,
            responsePreview: previewValue(row.response ?? row.responsePreview),
          };
        }),
      };
      continue;
    }
    collected[key] = entry;
  }
  return {
    collected,
    variables: src.variables || {},
    slimmed: true,
  };
}

function summarizeCollected(data: unknown): {
  collectedKeys: string[];
  networkHitCount: number;
  variableKeys: string[];
} {
  if (!data || typeof data !== "object") {
    return { collectedKeys: [], networkHitCount: 0, variableKeys: [] };
  }
  const d = data as {
    collected?: Record<string, { type?: string; content?: unknown[] }>;
    variables?: Record<string, unknown>;
  };
  const collected = d.collected || {};
  const collectedKeys = Object.keys(collected);
  let networkHitCount = 0;
  for (const key of collectedKeys) {
    const entry = collected[key];
    if (entry?.type === "array" && Array.isArray(entry.content)) {
      networkHitCount += entry.content.length;
    }
  }
  return {
    collectedKeys,
    networkHitCount,
    variableKeys: Object.keys(d.variables || {}),
  };
}

function shouldSlim(writePath: string, slim?: boolean): boolean {
  if (typeof slim === "boolean") return slim;
  return /probe/i.test(path.posix.basename(writePath.replace(/\\/g, "/")));
}

function persistOutcome(
  outcome: CrawlWaitOutcome,
  opts?: { config?: unknown; slim?: boolean; writePath?: string },
): {
  ok: boolean;
  taskId: string;
  error: string | null;
  /** 优先用这个绝对路径 Read/Write，避免拼到 Skill 目录 */
  absPath: string | null;
  writePath: string;
  bytes: number;
  slimmed: boolean;
  progressTail: string[];
  summary: ReturnType<typeof summarizeCollected>;
  hint: string;
} {
  const { result, progress } = outcome;
  const writePath = crawlTaskWritePath(result.taskId, opts?.writePath);
  const resolved = resolveWorkspacePath(writePath);
  if (!resolved.ok) {
    return {
      ok: false,
      taskId: result.taskId,
      error: resolved.error,
      absPath: null,
      writePath,
      bytes: 0,
      slimmed: false,
      progressTail: progress.slice(-30),
      summary: { collectedKeys: [], networkHitCount: 0, variableKeys: [] },
      hint: resolved.error,
    };
  }

  const slimmed = shouldSlim(writePath, opts?.slim);
  const data = slimmed ? slimCrawlData(result.data) : (result.data ?? null);
  fs.mkdirSync(path.dirname(resolved.abs), { recursive: true });
  const fileBody = {
    taskId: result.taskId,
    ok: result.ok,
    error: result.error ?? null,
    data,
    progress,
    config: opts?.config,
    slimmed,
    savedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(fileBody, null, 2);
  fs.writeFileSync(resolved.abs, json, "utf8");

  if (opts?.config !== undefined) {
    const configPath = path.join(path.dirname(resolved.abs), "config.json");
    fs.writeFileSync(configPath, JSON.stringify(opts.config, null, 2), "utf8");
  }

  const summary = summarizeCollected(data);
  const progressTail = progress.slice(-30);
  return {
    ok: result.ok,
    taskId: result.taskId,
    error: result.error ?? null,
    absPath: resolved.abs,
    writePath,
    bytes: Buffer.byteLength(json, "utf8"),
    slimmed,
    progressTail,
    summary,
    hint: result.ok
      ? `请用 absPath 做 Read（工作区绝对路径）。writePath=${writePath} 相对 workspace，禁止拼到 skills-plugin。`
      : "本轮失败：结合 error 与 progressTail 改 config 后重试，勿编造数据",
  };
}

const startCrawl = tool(
  "start_crawl",
  "向已连接的 Chrome 扩展下发抓取 workflow，立即返回 taskId。随后应调用 await_crawl；试配时可改用一次性的 run_crawl。",
  {
    config: workflowConfigField,
    priority: z.number().optional().describe("队列优先级，数字越小越靠前；可选"),
  },
  async (args) => {
    if (!isExtensionConnected()) {
      return textResult(
        {
          ok: false,
          error:
            "Chrome 扩展未连接。请先加载扩展并确保已连上 ws://127.0.0.1:19283",
        },
        true,
      );
    }
    const parsed = parseWorkflowConfig(args.config);
    if (!parsed.ok) return textResult({ ok: false, error: parsed.error }, true);
    const res = startCrawlTask(parsed.value, args.priority);
    if (!res.ok) return textResult({ ok: false, error: res.error }, true);
    return textResult({ ok: true, taskId: res.taskId });
  },
  { alwaysLoad: true },
);

const awaitCrawl = tool(
  "await_crawl",
  [
    "阻塞等待 start_crawl 下发的抓取任务完成。",
    "结果写入 crawl/<YYYYMMDD-HHmmss_短id>/<文件名>（默认 result.json）；同目录可有 config.json。目录名按时间可排序。",
    "工具返回只含路径、ok/error、progressTail、collected 摘要——不含完整 payload。",
    "完成后请用 Read 读取落盘文件。文件名含 probe 时默认 slim；定稿用 result.json 且 slim:false。",
    "失败时结合 error 与 progressTail 改 config 重试，勿编造数据。",
  ].join(" "),
  {
    taskId: z.string().describe("start_crawl 返回的 taskId"),
    timeoutMs: z
      .number()
      .default(180_000)
      .describe("最长等待毫秒，默认 180000（3 分钟）"),
    writePath: z
      .string()
      .default("result.json")
      .describe("落盘文件名（或任意路径，仅取 basename）；实际写入 crawl/<时间_短id>/<文件名>"),
    slim: z
      .boolean()
      .optional()
      .describe("落盘时压缩网络条目为 url/预览；文件名含 probe 时默认 true，定稿请显式 false"),
  },
  async (args) => {
    try {
      const outcome = await waitForCrawlResult(args.taskId, args.timeoutMs);
      return textResult(
        persistOutcome(outcome, { slim: args.slim, writePath: args.writePath }),
      );
    } catch (err) {
      return textResult(
        {
          ok: false,
          taskId: args.taskId,
          error: err instanceof Error ? err.message : String(err),
        },
        true,
      );
    }
  },
  { alwaysLoad: true },
);

const runCrawl = tool(
  "run_crawl",
  [
    "一次完成 start_crawl + await_crawl。",
    "结果写入 crawl/<YYYYMMDD-HHmmss_短id>/<文件名>（默认 result.json），同目录写入 config.json（含 instruction/outputSchema 若有）。",
    "工具返回路径、ok/error、progressTail、collected 摘要（不含完整 payload）。",
    "完成后请 Read 返回的 writePath；若 config 含 instruction+outputSchema，按 Skill workflow-task 处理并输出 JSON。",
    "探测用 writePath=probe.json（自动 slim），定稿 result.json + slim:false。失败勿编造数据。",
  ].join(" "),
  {
    config: workflowConfigField,
    timeoutMs: z.number().default(180_000).describe("最长等待毫秒，默认 180000（3 分钟）"),
    writePath: z
      .string()
      .default("result.json")
      .describe("落盘文件名；实际路径为 crawl/<时间_短id>/<文件名>。探测可用 probe.json"),
    slim: z
      .boolean()
      .optional()
      .describe("落盘压缩为 url/预览；文件名含 probe 时默认 true，定稿请显式 false"),
    priority: z.number().optional().describe("队列优先级，数字越小越靠前；可选"),
  },
  async (args) => {
    if (!isExtensionConnected()) {
      return textResult(
        {
          ok: false,
          error:
            "Chrome 扩展未连接。请先加载扩展并确保已连上 ws://127.0.0.1:19283",
        },
        true,
      );
    }
    const parsed = parseWorkflowConfig(args.config);
    if (!parsed.ok) return textResult({ ok: false, error: parsed.error }, true);

    const started = startCrawlTask(parsed.value, args.priority);
    if (!started.ok) return textResult({ ok: false, error: started.error }, true);

    try {
      const outcome = await waitForCrawlResult(started.taskId, args.timeoutMs);
      return textResult(
        persistOutcome(outcome, {
          config: parsed.value,
          slim: args.slim,
          writePath: args.writePath,
        }),
      );
    } catch (err) {
      return textResult(
        {
          ok: false,
          taskId: started.taskId,
          error: err instanceof Error ? err.message : String(err),
        },
        true,
      );
    }
  },
  { alwaysLoad: true },
);

const cancelCrawl = tool(
  "cancel_crawl",
  "取消抓取任务。不传 taskId 则取消当前执行并清空队列。",
  {
    taskId: z.string().optional().describe("要取消的 taskId；省略则取消全部"),
  },
  async (args) => {
    const res = cancelCrawlTask(args.taskId);
    if (!res.ok) return textResult({ ok: false, error: res.error }, true);
    return textResult({ ok: true, taskId: args.taskId ?? null });
  },
  { alwaysLoad: true },
);

const listCrawlResultsTool = tool(
  "list_crawl_results",
  "列出最近入库的抓取结果元数据（不含完整 payload）。",
  {
    limit: z.number().default(10).describe("最多返回条数，默认 10"),
  },
  async (args) => {
    try {
      const rows = listCrawlResults(args.limit).map((r) => ({
        id: r.id,
        taskId: r.taskId,
        ok: r.ok,
        error: r.error,
        createdAt: r.createdAt,
        payloadBytes: r.payloadBytes,
      }));
      return textResult({ ok: true, rows });
    } catch (err) {
      return textResult(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        true,
      );
    }
  },
  { alwaysLoad: true, annotations: { readOnlyHint: true } },
);

/** 进程内 MCP：供 Agent 直接触发/等待/取消抓取 */
export const crawlMcpServer = createSdkMcpServer({
  name: "crawl",
  version: "1.0.0",
  instructions:
    "抓取：不确定接口时用宽 reg_exp（如 \".\"）+ run_crawl 多轮试配，再定稿。扩展须已连接。",
  tools: [startCrawl, awaitCrawl, runCrawl, cancelCrawl, listCrawlResultsTool],
  alwaysLoad: true,
});
