import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { ensureWorkspaceDir, getPythonBinDir, getPythonExecutable } from "../paths";

const OUTPUT_MAX_CHARS = 30_000;
const DEFAULT_TIMEOUT_SEC = 120;
const MAX_TIMEOUT_SEC = 1800;
const SNIPPET_DIR = "tmp-python";

const running = new Set<ChildProcess>();

function textResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function isInsideWorkspace(workspace: string, targetPath: string): boolean {
  const abs = path.resolve(workspace, targetPath);
  const rel = path.relative(workspace, abs);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * 在给定 env 上把内置 Python 放到 PATH 最前，并固定 UTF-8 / 不写 pyc / 不读用户 site-packages。
 * Windows 的 env 键大小写不敏感，但展开成普通对象后可能是 Path，需按原键名覆盖。
 */
export function withBundledPython(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  return {
    ...env,
    [pathKey]: [getPythonBinDir(), env[pathKey]].filter(Boolean).join(path.delimiter),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
  };
}

/** 连同脚本自己起的子进程一起结束 */
function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/** 用户停止 Agent 时调用 */
export function killRunningPython(): void {
  for (const child of running) killTree(child);
}

function clip(text: string): string {
  if (text.length <= OUTPUT_MAX_CHARS) return text;
  const half = OUTPUT_MAX_CHARS / 2;
  return `${text.slice(0, half)}\n…(中间省略 ${text.length - OUTPUT_MAX_CHARS} chars)…\n${text.slice(-half)}`;
}

function snippetPath(workspace: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const rand = Math.random().toString(36).slice(2, 6);
  return path.join(workspace, SNIPPET_DIR, `snippet-${stamp}-${rand}.py`);
}

interface RunOutcome {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function runScript(
  exe: string,
  scriptAbs: string,
  args: string[],
  workspace: string,
  timeoutSec: number,
): Promise<RunOutcome> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(exe, [scriptAbs, ...args], {
      cwd: workspace,
      env: withBundledPython(process.env),
      windowsHide: true,
      // 独立进程组，超时/停止时可整组结束
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    running.add(child);

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
    });
    child.stderr?.setEncoding("utf8").on("data", (d: string) => {
      stderr += d;
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutSec * 1000);

    child.once("error", (err) => {
      clearTimeout(timer);
      running.delete(child);
      reject(err);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      running.delete(child);
      resolve({ exitCode: code, timedOut, stdout, stderr, durationMs: Date.now() - started });
    });
  });
}

const runPython = tool(
  "run_python",
  [
    "用客户端内置的 Python 3.12 执行脚本（mac / Windows 一致，不依赖系统 Python 或 shell）。",
    "二选一：script 传工作区内 .py 相对路径；或 code 传源码（会落盘到 tmp-python/ 再执行）。",
    "工作目录固定为工作区根目录，文件读写请用相对路径。",
    "返回 exitCode、stdout、stderr（过长会截断中间部分）；大结果请让脚本写文件，再用 Read 读取。",
    "需要处理文件、批量计算、格式转换、调用标准库时用本工具，不要用 Bash / PowerShell。",
  ].join(" "),
  {
    script: z.string().optional().describe("工作区内 .py 文件的相对路径，如 scripts/analyze.py"),
    code: z.string().optional().describe("Python 源码；与 script 二选一"),
    args: z.array(z.string()).default([]).describe("传给脚本的命令行参数（sys.argv[1:]）"),
    timeoutSec: z
      .number()
      .default(DEFAULT_TIMEOUT_SEC)
      .describe(`超时秒数，默认 ${DEFAULT_TIMEOUT_SEC}，最大 ${MAX_TIMEOUT_SEC}`),
  },
  async (args) => {
    const exe = getPythonExecutable();
    if (!exe) {
      return textResult(
        { ok: false, error: "内置 Python 不存在。开发环境请先执行 npm run python:fetch" },
        true,
      );
    }
    if (Boolean(args.script) === Boolean(args.code)) {
      return textResult({ ok: false, error: "script 与 code 必须且只能传一个" }, true);
    }

    const workspace = ensureWorkspaceDir();
    let scriptAbs: string;
    if (args.script) {
      const rel = args.script.replace(/\\/g, "/").replace(/^\.\//, "");
      if (path.isAbsolute(rel) || !isInsideWorkspace(workspace, rel)) {
        return textResult({ ok: false, error: `脚本必须在工作区内: ${args.script}` }, true);
      }
      scriptAbs = path.resolve(workspace, rel);
      if (!fs.existsSync(scriptAbs)) {
        return textResult({ ok: false, error: `脚本不存在: ${args.script}` }, true);
      }
    } else {
      scriptAbs = snippetPath(workspace);
      fs.mkdirSync(path.dirname(scriptAbs), { recursive: true });
      fs.writeFileSync(scriptAbs, args.code ?? "", "utf8");
    }

    const timeoutSec = Math.min(Math.max(args.timeoutSec, 1), MAX_TIMEOUT_SEC);
    try {
      const out = await runScript(exe, scriptAbs, args.args, workspace, timeoutSec);
      const ok = out.exitCode === 0 && !out.timedOut;
      return textResult(
        {
          ok,
          exitCode: out.exitCode,
          timedOut: out.timedOut,
          durationMs: out.durationMs,
          script: path.relative(workspace, scriptAbs).replace(/\\/g, "/"),
          stdout: clip(out.stdout),
          stderr: clip(out.stderr),
          ...(out.timedOut
            ? { error: `超时（${timeoutSec}s）已结束进程` }
            : out.exitCode === null
              ? { error: "进程被结束（用户停止）" }
              : {}),
        },
        !ok,
      );
    } catch (err) {
      return textResult(
        { ok: false, error: `启动 Python 失败: ${err instanceof Error ? err.message : String(err)}` },
        true,
      );
    }
  },
  { alwaysLoad: true },
);

/** 进程内 MCP：用内置解释器执行 Python，替代依赖 shell 的 Bash / PowerShell */
export const pythonMcpServer = createSdkMcpServer({
  name: "python",
  version: "1.0.0",
  instructions:
    "执行 Python 一律用 run_python（内置 3.12，跨平台一致）。脚本相对工作区根目录读写文件。",
  tools: [runPython],
  alwaysLoad: true,
});
