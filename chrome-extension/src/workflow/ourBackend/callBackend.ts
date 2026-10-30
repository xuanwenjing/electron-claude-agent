import { Request } from "../../shared/request";
import type { Collector, EmitFn, WorkflowItem } from "../types";
import { getDeepValue, resolveMaybeExpr } from "../util";
import { collectNetworkHit } from "../collect";

const api = new Request();

/** 返回后端返回体，由步骤的 save_as 写入变量 */
export async function handleCallBackend(
  collector: Collector,
  workflowItem: WorkflowItem,
  emit: EmitFn,
): Promise<unknown> {
  const params = workflowItem.call_backend_params;
  if (!params?.url) {
    throw new Error("call_backend 需要 call_backend_params.url");
  }

  const url = String(resolveMaybeExpr(collector.variables, params.url));
  if (!url) throw new Error("call_backend url 为空");
  const method = params.method ?? "POST";
  emit(`call_backend: ${method} ${url}`);

  const data = params.data === undefined ? undefined : getDeepValue(collector.variables, params.data);
  const query = params.params ? (getDeepValue(collector.variables, params.params) as Record<string, unknown>) : undefined;
  const body = await api.request({
    url,
    method,
    data,
    params: query,
    headers: params.headers,
    timeout: params.timeout,
  });

  if (body?.code !== 200) {
    throw new Error(`call_backend ${method} ${url} 失败 code=${body?.code}: ${body?.msg || body?.message || ""}`);
  }

  // need_collect 与 call_api 网络命中同一套：写入 collected[event]
  const qs = query
    ? new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]),
      ).toString()
    : "";
  collectNetworkHit(collector, workflowItem, {
    requestData: data ?? {},
    responseData: body,
    api: qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url,
    method,
    headers: params.headers ?? {},
  });
  return body;
}
