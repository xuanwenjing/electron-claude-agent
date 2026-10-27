import type { Collector, EmitFn, WorkflowItem } from "../types";
import { getDeepValue, resolveMaybeExpr } from "../util";
import { resolveEvent } from "../collect";
import { getOurBackendConfig, ourBackendHeaders } from "./auth";

export async function handleCallBackend(
  collector: Collector,
  workflowItem: WorkflowItem,
  emit: EmitFn,
): Promise<void> {
  const params = workflowItem.call_backend_params;
  if (!params?.type) {
    throw new Error("call_backend 需要 call_backend_params.type");
  }

  const apiType = String(resolveMaybeExpr(collector.variables, params.type));
  const payload = getDeepValue(collector.variables, params.payload ?? {});
  if (!apiType) throw new Error("call_backend type 为空");

  const cfg = await getOurBackendConfig();
  emit(`call_backend: type=${apiType}`);

  const res = await fetch(`${cfg.baseUrl}/client/task/ingest`, {
    method: "POST",
    headers: ourBackendHeaders(cfg),
    body: JSON.stringify({
      type: apiType,
      payload,
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`call_backend ${apiType} 失败 HTTP ${res.status}: ${JSON.stringify(body)}`);
  }

  const event = resolveEvent(collector, workflowItem, "call_backend");
  collector.variables[event] = body;
  collector.variables._backendResult = body;
  if (workflowItem.need_collect || workflowItem.event) {
    collector.data[event] = { type: "text", value: body };
  }
}
