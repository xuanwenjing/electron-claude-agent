import type { Collector, EmitFn, WorkflowItem } from "../types";
import type { CancelToken } from "../util";
import { getDeepValue, resolveMaybeExpr } from "../util";
import { resolveEvent } from "../collect";
import { getOurBackendConfig, ourBackendHeaders } from "./auth";

function asContentString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

async function readSseContent(
  response: Response,
  token?: CancelToken | null,
): Promise<string> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    return text;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let generated = "";

  while (true) {
    if (token?.cancelled) {
      await reader.cancel();
      throw new Error("任务已取消");
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (buffer.includes("\n\n")) {
      const idx = buffer.indexOf("\n\n");
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.slice(5).trim();
        if (!dataStr || dataStr === "[DONE]") continue;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(dataStr) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(data, "error")) {
          throw new Error(`call_bot SSE error: ${JSON.stringify(data.error)}`);
        }
        const choices = data.choices as Array<{ delta?: { content?: string } }> | undefined;
        const delta = choices?.[0]?.delta?.content;
        if (delta) generated += delta;
      }
    }
  }
  return generated;
}

function writeBotResult(collector: Collector, workflowItem: WorkflowItem, text: string): void {
  collector.variables._botResult = text;
  const event = resolveEvent(collector, workflowItem, "call_bot");
  collector.variables[event] = text;
  if (workflowItem.need_collect || workflowItem.event) {
    collector.data[event] = { type: "text", value: text };
  }
}

export async function handleCallBot(
  collector: Collector,
  workflowItem: WorkflowItem,
  emit: EmitFn,
  token?: CancelToken | null,
): Promise<void> {
  const params = workflowItem.call_bot_params;
  if (!params?.bot_code) {
    throw new Error("call_bot 需要 call_bot_params.bot_code 与 content");
  }

  const botCode = String(resolveMaybeExpr(collector.variables, params.bot_code));
  const content = asContentString(getDeepValue(collector.variables, params.content));
  const hotelCode = params.hotel_code
    ? String(resolveMaybeExpr(collector.variables, params.hotel_code))
    : undefined;
  const extraPayload =
    (getDeepValue(collector.variables, params.payload || {}) as Record<string, unknown>) || {};

  if (!botCode) throw new Error("call_bot bot_code 为空");
  if (!content) throw new Error("call_bot content 为空");

  const cfg = await getOurBackendConfig();
  const headers = ourBackendHeaders(cfg, hotelCode);
  emit(`call_bot: bot_code=${botCode}`);

  const created = await fetch(`${cfg.baseUrl}/agent/conversations/create`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      bot_code: botCode,
      hotel_code: hotelCode || cfg.hotelCode || "",
    }),
  });
  const createdJson = (await created.json().catch(() => null)) as {
    code?: number;
    data?: { conversation_id?: string };
  } | null;
  if (!created.ok || createdJson?.code !== 200 || !createdJson.data?.conversation_id) {
    throw new Error(`call_bot 创建会话失败: ${JSON.stringify(createdJson ?? { status: created.status })}`);
  }

  const chatRes = await fetch(`${cfg.baseUrl}/agent/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      conversation_id: createdJson.data.conversation_id,
      bot_code: botCode,
      content,
      client_req_id: `${botCode}_${Date.now()}`,
      payload: extraPayload,
    }),
  });
  if (!chatRes.ok) {
    throw new Error(`call_bot 生成失败 HTTP ${chatRes.status}`);
  }

  const generated = (await readSseContent(chatRes, token)).trim();
  if (!generated || generated.includes("系统繁忙")) {
    throw new Error(`call_bot 未生成内容: ${generated || "(empty)"}`);
  }

  writeBotResult(collector, workflowItem, generated);
  emit(`call_bot 完成，长度 ${generated.length}`);
}
