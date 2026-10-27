import type { CallApiParam, Collector, EmitFn, WorkflowItem } from "../types";
import type { CancelToken } from "../util";
import { cancellableSleep, getDeepValue, resolveMaybeExpr } from "../util";
import { pageFetch } from "./pageFetch";

export async function transformCallApiParams(
  variables: Record<string, unknown>,
  fetchItem: CallApiParam,
): Promise<{
  newUrl: string;
  newBody: BodyInit | null;
  newHeaders: Record<string, string>;
  newQuery: Record<string, unknown>;
}> {
  // 对齐 CommentCollectHandler.tranformCallApiParams → common_getDeepValue（含 __ref）
  let newBody: unknown = getDeepValue(variables, fetchItem?.payload || {});
  let newHeaders =
    (getDeepValue(variables, fetchItem?.headers || {}) as Record<string, string>) || {};
  const newQuery =
    (getDeepValue(variables, fetchItem?.query_params || {}) as Record<string, unknown>) || {};

  if (newHeaders["content-type"]) {
    newHeaders["Content-Type"] = newHeaders["content-type"];
    delete newHeaders["content-type"];
  }

  let bodyOut: BodyInit | null;
  if (String(newHeaders["Content-Type"] || "").includes("x-www-form-urlencoded")) {
    bodyOut = new URLSearchParams(newBody as Record<string, string>).toString();
  } else if (fetchItem.method && String(fetchItem.method).toUpperCase() !== "GET") {
    bodyOut = typeof newBody === "string" ? newBody : JSON.stringify(newBody ?? {});
    if (!newHeaders["Content-Type"]) newHeaders["Content-Type"] = "application/json";
  } else {
    bodyOut = null;
  }

  let newUrl = String(resolveMaybeExpr(variables, fetchItem.url));
  if (newQuery && Object.keys(newQuery).length > 0) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(newQuery).map(([k, v]) => [k, String(v)])),
    ).toString();
    newUrl = `${newUrl}${newUrl.includes("?") ? "&" : "?"}${qs}`;
  }
  return { newUrl, newBody: bodyOut, newHeaders, newQuery };
}

/** 只负责宿主页发请求；采集靠 networkInterceptor → updateData */
export async function handleApiFetch(
  tabId: number | null,
  _collector: Collector,
  workflowItem: WorkflowItem,
  emit: EmitFn,
  token?: CancelToken | null,
): Promise<void> {
  if (tabId == null) throw new Error("call_api 前需要先 navigate 打开宿主页");
  let params = workflowItem.call_api_params;
  if (!params) return;
  if (!Array.isArray(params)) params = [params];

  for (const fetchItem of params) {
    const { newUrl, newBody, newHeaders } = await transformCallApiParams(
      _collector.variables,
      fetchItem,
    );
    emit(`pageFetch: ${fetchItem.method || "GET"} ${newUrl}`);
    const res = await pageFetch(tabId, newUrl, {
      method: fetchItem.method || "GET",
      headers: newHeaders,
      body: newBody,
    });
    if (!res.ok) {
      throw new Error(`fetch ${fetchItem.url} failed: ${JSON.stringify(res)}`);
    }
    // 对齐 CommentCollectHandler：random * 3000 + 2000
    await cancellableSleep(Math.random() * 3000 + 2000, token);
  }
}
