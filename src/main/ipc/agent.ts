import { ipcMain } from "electron";

import { killRunningPython } from "../agent/pythonMcp";
import { AgentStoppedError, runAgent } from "../agent/runAgent";
import { cancelCrawlTask } from "../crawl/bridgeServer";
import { sendToRenderer } from "../window";
import { toErrorMessage } from "./errors";

let running = false;
let agentAbort: AbortController | null = null;

export function registerAgentIpc(): void {
  ipcMain.handle("agent:run", async (_event, prompt: string) => {
    if (running) {
      return { ok: false as const, error: "已有任务在运行，请稍候" };
    }
    if (!prompt || typeof prompt !== "string") {
      return { ok: false as const, error: "prompt 不能为空" };
    }
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      return {
        ok: false as const,
        error: "未配置 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN，请复制 .env.example 为 .env 并填写",
      };
    }

    running = true;
    const abortController = new AbortController();
    agentAbort = abortController;
    try {
      const result = await runAgent({
        prompt,
        abortController,
        onEvent: (event) => {
          sendToRenderer("agent:event:message", event);
        },
      });
      return { ok: true as const, result };
    } catch (err) {
      if (err instanceof AgentStoppedError || abortController.signal.aborted) {
        sendToRenderer("agent:event:message", {
          kind: "log",
          text: "已停止",
        });
        return { ok: false as const, error: "已停止", stopped: true as const };
      }
      const message = toErrorMessage(err);
      sendToRenderer("agent:event:message", { kind: "error", text: message });
      return { ok: false as const, error: message };
    } finally {
      running = false;
      if (agentAbort === abortController) agentAbort = null;
    }
  });

  ipcMain.handle("agent:stop", () => {
    if (!running || !agentAbort) {
      return { ok: false as const, error: "当前没有运行中的 Agent" };
    }
    try {
      cancelCrawlTask();
    } catch {
      // 扩展未连接时忽略
    }
    killRunningPython();
    agentAbort.abort();
    sendToRenderer("agent:event:message", {
      kind: "log",
      text: "正在停止…",
    });
    return { ok: true as const };
  });
}
