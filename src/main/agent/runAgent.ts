import { AbortError, query } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";

import { crawlMcpServer } from "./crawlMcp";
import { ensureWorkspaceDir, getPythonExecutable, getSkillsPluginDir } from "../paths";
import { pythonMcpServer, withBundledPython } from "./pythonMcp";
import { resolveClaudeCli } from "./resolveClaudeCli";

export interface AgentProgressEvent {
  kind: "log" | "assistant" | "tool" | "result" | "error";
  text: string;
}

export interface RunAgentOptions {
  prompt: string;
  model?: string;
  abortController?: AbortController;
  onEvent: (event: AgentProgressEvent) => void;
}

/** 用户主动停止 */
export class AgentStoppedError extends Error {
  constructor(message = "已停止") {
    super(message);
    this.name = "AgentStoppedError";
  }
}

function isInsideDir(root: string, targetPath: string): boolean {
  const abs = path.resolve(root, targetPath);
  const rel = path.relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function summarizePayload(value: unknown, max = 1200): string {
  try {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    if (raw.length <= max) return raw;
    return `${raw.slice(0, max)}…(截断, ${raw.length} chars)`;
  } catch {
    return String(value);
  }
}

/**
 * 模型常把 crawl/ 相对路径拼到 Skill 目录下。
 * 若命中 skills-plugin/.../crawl/...，改写到 workspace/crawl/...
 */
function remapMistakenSkillCrawlPath(
  filePath: string,
  workspace: string,
): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const underSkills =
    normalized.includes("/skills-plugin/") ||
    normalized.includes("/skills/workflow-task/") ||
    normalized.includes("/skills/crawl-analyze/");
  if (!underSkills) return null;
  const m = normalized.match(/\/crawl\/(.+)$/);
  if (!m) return null;
  return path.join(workspace, "crawl", m[1]);
}

function rewriteToolPathInput(
  toolName: string,
  toolInput: unknown,
  workspace: string,
): Record<string, unknown> | null {
  if (!toolInput || typeof toolInput !== "object") return null;
  const input = { ...(toolInput as Record<string, unknown>) };
  const keys =
    toolName === "Bash"
      ? ([] as string[])
      : (["file_path", "path", "notebook_path"] as const);
  let changed = false;
  for (const key of keys) {
    const v = input[key];
    if (typeof v !== "string") continue;
    const fixed = remapMistakenSkillCrawlPath(v, workspace);
    if (fixed && fixed !== v) {
      input[key] = fixed;
      changed = true;
    }
  }
  return changed ? input : null;
}

/**
 * 跑一轮 Claude Agent query。
 * - 开启 Skill（通过本地 plugin）
 * - 进程内 MCP crawl：start/await/cancel/list
 * - 进程内 MCP python：run_python（内置解释器，不依赖 shell）
 * - 允许 Read / Write / Glob / Grep / Bash（Skill 可读写工作区）
 * - Windows 屏蔽 PowerShell：没装 Git Bash 时 CLI 会用它顶替 Bash，命令写法与权限规则都对不上
 * - 工具入参/结果通过 PreToolUse/PostToolUse hook 打日志（allowedTools 自动批准时 canUseTool 不会触发）
 */
export async function runAgent(options: RunAgentOptions): Promise<string> {
  const { prompt, onEvent, abortController } = options;
  const workspace = ensureWorkspaceDir();
  const skillsPlugin = getSkillsPluginDir();
  const cliPath = resolveClaudeCli();
  const model = options.model || process.env.ANTHROPIC_MODEL || undefined;

  onEvent({ kind: "log", text: `CLI: ${cliPath}` });
  onEvent({ kind: "log", text: `工作区: ${workspace}` });
  onEvent({ kind: "log", text: `Skills 插件: ${skillsPlugin}` });
  onEvent({ kind: "log", text: "MCP: crawl (run_crawl / start_crawl / await_crawl / …)" });
  onEvent({ kind: "log", text: `MCP: python (run_python) → ${getPythonExecutable() ?? "未找到内置 Python"}` });
  if (model) onEvent({ kind: "log", text: `模型: ${model}` });

  let finalText = "";

  try {
    for await (const message of query({
      prompt,
      options: {
      cwd: workspace,
      model,
      abortController,
      pathToClaudeCodeExecutable: cliPath,
      // 不读取用户本机 ~/.claude，只用我们打包的 plugin
      settingSources: [],
      plugins: [{ type: "local", path: skillsPlugin }],
      skills: "all",
      mcpServers: { crawl: crawlMcpServer, python: pythonMcpServer },
      allowedTools: [
        "Read",
        "Write",
        "Glob",
        "Grep",
        "Bash",
        "Skill",
        "mcp__crawl__*",
        "mcp__python__*",
      ],
      disallowedTools: [
        "Bash(rm -rf *)",
        "Bash(sudo *)",
        ...(process.platform === "win32" ? ["PowerShell"] : []),
      ],
      permissionMode: "default",
      env: {
        ...withBundledPython(process.env),
        // 标识来源，方便网关侧排查
        CLAUDE_AGENT_SDK_CLIENT_APP: "electron-claude-agent",
      },
      stderr: (data) => {
        const text = data.trim();
        if (text) onEvent({ kind: "log", text: `[stderr] ${text}` });
      },
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (input) => {
                if (input.hook_event_name !== "PreToolUse") return {};
                const rewritten = rewriteToolPathInput(
                  input.tool_name,
                  input.tool_input,
                  workspace,
                );
                if (!rewritten) return {};
                onEvent({
                  kind: "log",
                  text: `已纠正工具路径 → 工作区: ${summarizePayload(rewritten, 400)}`,
                });
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    updatedInput: rewritten,
                  },
                };
              },
            ],
          },
        ],
        PostToolUse: [
          {
            hooks: [
              async (input) => {
                if (input.hook_event_name !== "PostToolUse") return {};
                // onEvent({
                //   kind: "tool",
                //   text: `工具结果 ${input.tool_name}: ${summarizePayload(input.tool_response)}`,
                // });
                return {};
              },
            ],
          },
        ],
        PostToolUseFailure: [
          {
            hooks: [
              async (input) => {
                if (input.hook_event_name !== "PostToolUseFailure") return {};
                const err =
                  "error" in input
                    ? summarizePayload((input as { error?: unknown }).error)
                    : "unknown";
                onEvent({
                  kind: "error",
                  text: `工具失败 ${input.tool_name}: ${err}`,
                });
                return {};
              },
            ],
          },
        ],
      },
      canUseTool: async (toolName, input) => {
        // 注意：列在 allowedTools 里的工具会自动批准，通常不会走到这里
        onEvent({
          kind: "tool",
          text: `请求工具 ${toolName}: ${summarizePayload(input)}`,
        });

        if (toolName.startsWith("mcp__crawl__") || toolName.startsWith("mcp__python__")) {
          return { behavior: "allow", updatedInput: input };
        }

        if (toolName === "PowerShell") {
          return { behavior: "deny", message: "已禁用 PowerShell，执行 Python 请用 mcp__python__run_python" };
        }

        if (toolName === "Bash") {
          const command = String((input as { command?: string }).command ?? "");
          onEvent({ kind: "log", text: `自动批准 Bash: ${command}` });
          return {
            behavior: "allow",
            updatedInput: input,
          };
        }

        const filePath =
          (input as { file_path?: string; path?: string }).file_path ??
          (input as { path?: string }).path;
        if (typeof filePath === "string") {
          const inWorkspace = isInsideDir(workspace, filePath);
          const inSkills = isInsideDir(skillsPlugin, filePath);
          const readOnlyTool =
            toolName === "Read" || toolName === "Glob" || toolName === "Grep";
          if (inWorkspace) {
            /* ok */
          } else if (inSkills && readOnlyTool) {
            onEvent({ kind: "log", text: `允许读取 Skill 文件: ${filePath}` });
          } else {
            return {
              behavior: "deny",
              message: inSkills
                ? `Skills 插件目录只读，禁止 ${toolName}: ${filePath}`
                : `路径超出工作区: ${filePath}`,
            };
          }
        }

        return {
          behavior: "allow",
          updatedInput: input,
        };
      },
    },
  })) {
    if (message.type === "assistant") {
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object" && "type" in block) {
            if (block.type === "text" && "text" in block) {
              onEvent({ kind: "assistant", text: String(block.text) });
            } else if (block.type === "tool_use" && "name" in block) {
              const input =
                "input" in block ? (block as { input?: unknown }).input : undefined;
              onEvent({
                kind: "tool",
                text: input
                  ? `工具调用: ${String(block.name)} ${summarizePayload(input, 800)}`
                  : `工具调用: ${String(block.name)}`,
              });
            }
          }
        }
      }
    }

    if (message.type === "user") {
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block &&
            typeof block === "object" &&
            "type" in block &&
            block.type === "tool_result"
          ) {
            const tr = block as {
              tool_use_id?: string;
              content?: unknown;
              is_error?: boolean;
            };
            const body =
              typeof tr.content === "string"
                ? tr.content
                : summarizePayload(tr.content ?? message.tool_use_result);
            onEvent({
              kind: tr.is_error ? "error" : "tool",
              text: `工具返回${tr.is_error ? "(错误)" : ""}: ${summarizePayload(body)}`,
            });
          }
        }
      } else if (message.tool_use_result != null) {
        onEvent({
          kind: "tool",
          text: `工具返回: ${summarizePayload(message.tool_use_result)}`,
        });
      }
    }

    if (message.type === "result") {
      if (message.subtype === "success") {
        finalText = message.result;
        onEvent({ kind: "result", text: finalText });
      } else if (
        message.subtype === "error_during_execution" &&
        abortController?.signal.aborted
      ) {
        throw new AgentStoppedError();
      } else {
        const errText = `模型调用失败: ${message.subtype}`;
        onEvent({ kind: "error", text: errText });
        throw new Error(errText);
      }
    }
    }
  } catch (err) {
    if (
      abortController?.signal.aborted ||
      err instanceof AbortError ||
      err instanceof AgentStoppedError ||
      (err instanceof Error && /abort/i.test(err.name + err.message))
    ) {
      throw new AgentStoppedError();
    }
    throw err;
  }

  if (abortController?.signal.aborted) {
    throw new AgentStoppedError();
  }

  if (!finalText) {
    throw new Error("模型未返回最终结果");
  }
  return finalText;
}
