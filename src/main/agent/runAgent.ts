import { AbortError, query } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";

import { authSession } from "../auth";
import { deviceHeaders } from "../tasks/report";
import { getPythonExecutable } from "../utils/paths";
import { defaultSettings } from "../utils/request";
import { createPythonSession, withBundledPython } from "./pythonMcp";
import { resolveClaudeCli } from "./resolveClaudeCli";

export interface AgentProgressEvent {
  kind: "log" | "assistant" | "tool" | "result" | "error";
  text: string;
}

export interface RunAgentOptions {
  prompt: string;
  model?: string;
  /** 单次模型回复的输出上限，不传用 CLI 默认值 */
  maxTokens?: number;
  /** 模型与工具往返的最大轮数，不传不限 */
  maxTurns?: number;
  /** 追加在 Claude Code 默认系统提示词之后 */
  systemPrompt?: string;
  /** Skill 插件目录 */
  pluginDirs?: string[];
  /** 工作目录（cwd、文件读写边界、Python 工作目录）；并行的 Agent 各用各的 */
  workDir: string;
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

/**
 * 大模型走后端网关：鉴权用登录 token，地址是 CLIENT_API_BASE_URL + /chat，
 * 公共请求头（Source、门店、设备号）通过 ANTHROPIC_CUSTOM_HEADERS 带上，每行一个 "Name: Value"。
 */
export function agentGatewayEnv(): {
  ANTHROPIC_AUTH_TOKEN: string;
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_CUSTOM_HEADERS: string;
} {
  const { token, outletCode } = authSession.getRequestContext();
  if (!token || !outletCode) throw new Error("请先登录并进入门店，再运行 run_agent");
  const baseUrl = process.env.CLIENT_API_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("客户端未配置 CLIENT_API_BASE_URL");
  const headers = { ...defaultSettings, "Outlet-Code": outletCode, ...deviceHeaders() };
  return {
    ANTHROPIC_AUTH_TOKEN: token,
    ANTHROPIC_BASE_URL: `${baseUrl}/chat`,
    ANTHROPIC_CUSTOM_HEADERS: Object.entries(headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join("\n"),
  };
}

/** 用户电脑上的 ANTHROPIC_* / CLAUDE_* 会改变 CLI 的鉴权、地址或配置目录，不传给 CLI */
function withoutClaudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !/^(ANTHROPIC|CLAUDE)_/i.test(key)),
  );
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
 * 跑一轮 Claude Agent query（workflow run_agent 步骤，见 workflowAgent.ts）。
 * - 开启 Skill（通过本地 plugin）
 * - 进程内 MCP python：run_python（内置解释器，不依赖 shell）
 * - 允许 Read / Write / Glob / Grep / Bash（Skill 可读写工作区）
 * - Windows 屏蔽 PowerShell：没装 Git Bash 时 CLI 会用它顶替 Bash，命令写法与权限规则都对不上
 * - 工具失败通过 PostToolUseFailure hook 打日志（allowedTools 自动批准时 canUseTool 不会触发）
 */
export async function runAgent(options: RunAgentOptions): Promise<string> {
  const { prompt, onEvent, abortController } = options;
  const workspace = options.workDir;
  const pluginDirs = options.pluginDirs ?? [];
  const cliPath = resolveClaudeCli();
  const gateway = agentGatewayEnv();
  const model = options.model || undefined;
  const python = createPythonSession(workspace);
  const onAbort = () => python.killAll();
  abortController?.signal.addEventListener("abort", onAbort, { once: true });

  onEvent({ kind: "log", text: `CLI: ${cliPath}` });
  onEvent({ kind: "log", text: `工作区: ${workspace}` });
  onEvent({ kind: "log", text: `Skills 插件: ${pluginDirs.length ? pluginDirs.join(", ") : "无"}` });
  onEvent({ kind: "log", text: `MCP: python (run_python) → ${getPythonExecutable() ?? "未找到内置 Python"}` });
  onEvent({ kind: "log", text: `网关: ${gateway.ANTHROPIC_BASE_URL}` });
  if (model) onEvent({ kind: "log", text: `模型: ${model}` });
  if (options.maxTokens) onEvent({ kind: "log", text: `输出上限: ${options.maxTokens} tokens` });
  if (options.maxTurns) onEvent({ kind: "log", text: `最大轮数: ${options.maxTurns}` });

  let finalText = "";

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: workspace,
        model,
        ...(options.maxTurns ? { maxTurns: options.maxTurns } : {}),
        abortController,
        pathToClaudeCodeExecutable: cliPath,
        ...(options.systemPrompt
          ? { systemPrompt: { type: "preset" as const, preset: "claude_code" as const, append: options.systemPrompt } }
          : {}),
        // 不读取用户本机 ~/.claude，只用我们指定的 plugin
        settingSources: [],
        plugins: pluginDirs.map((dir) => ({ type: "local" as const, path: dir })),
        skills: "all",
        mcpServers: { python: python.server },
        allowedTools: [
          "Read",
          "Write",
          "Glob",
          "Grep",
          "Bash",
          "Skill",
          "mcp__python__*",
        ],
        disallowedTools: [
          "Bash(rm -rf *)",
          "Bash(sudo *)",
          ...(process.platform === "win32" ? ["PowerShell"] : []),
        ],
        permissionMode: "default",
        env: {
          ...withBundledPython(withoutClaudeEnv(process.env)),
          ...gateway,
          ...(options.maxTokens ? { CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(options.maxTokens) } : {}),
          // 标识来源，方便网关侧排查
          CLAUDE_AGENT_SDK_CLIENT_APP: "electron-claude-agent",
        },
        stderr: (data) => {
          const text = data.trim();
          if (text) onEvent({ kind: "log", text: `[stderr] ${text}` });
        },
        hooks: {
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

          if (toolName.startsWith("mcp__python__")) {
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
            const inSkills = pluginDirs.some((dir) => isInsideDir(dir, filePath));
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
        const errText =
          message.subtype === "error_max_turns"
            ? `模型超过最大轮数 ${options.maxTurns} 仍未完成`
            : `模型调用失败: ${message.subtype}`;
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
  } finally {
    abortController?.signal.removeEventListener("abort", onAbort);
    // Agent 结束后不应再有它启动的 Python 在跑（超时 / 异常退出时可能遗留）
    python.killAll();
  }

  if (abortController?.signal.aborted) {
    throw new AgentStoppedError();
  }

  if (!finalText) {
    throw new Error("模型未返回最终结果");
  }
  return finalText;
}
