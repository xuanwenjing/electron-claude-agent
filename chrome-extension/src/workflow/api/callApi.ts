import { CallApiMode, CallApiSign } from "../types";
import type { CallApiParam, Collector, EmitFn, WorkflowItem } from "../types";
import type { CancelToken } from "../util";
import { cancellableSleep, getDeepValue, resolveMaybeExpr } from "../util";
import { pageFetch } from "./pageFetch";
import { requestMtop, signMtgsig } from "./platformRequest";

const MODES = Object.values(CallApiMode) as string[];
const SIGNS = Object.values(CallApiSign) as string[];

export async function transformCallApiParams(
  variables: Record<string, unknown>,
  fetchItem: CallApiParam,
): Promise<{
  newUrl: string;
  newBody: string | null;
  newHeaders: Record<string, string>;
  newQuery: Record<string, unknown>;
  newPayload: unknown;
}> {
  // 对齐 CommentCollectHandler.tranformCallApiParams → common_getDeepValue（含 __ref）
  const newPayload: unknown = getDeepValue(variables, fetchItem?.payload || {});
  let newHeaders =
    (getDeepValue(variables, fetchItem?.headers || {}) as Record<string, string>) || {};
  const newQuery =
    (getDeepValue(variables, fetchItem?.query_params || {}) as Record<string, unknown>) || {};

  if (newHeaders["content-type"]) {
    newHeaders["Content-Type"] = newHeaders["content-type"];
    delete newHeaders["content-type"];
  }

  let bodyOut: string | null;
  if (String(newHeaders["Content-Type"] || "").includes("x-www-form-urlencoded")) {
    bodyOut = new URLSearchParams(newPayload as Record<string, string>).toString();
  } else if (fetchItem.method && String(fetchItem.method).toUpperCase() !== "GET") {
    bodyOut = typeof newPayload === "string" ? newPayload : JSON.stringify(newPayload ?? {});
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
  return { newUrl, newBody: bodyOut, newHeaders, newQuery, newPayload };
}

/** 发请求前统一校验，避免多条请求发到一半才报配置错误 */
function assertCallApiParam(fetchItem: CallApiParam, index: number): void {
  const at = `call_api_params[${index}]`;
  if (!fetchItem?.url) throw new Error(`${at}.url 不能为空`);
  if (fetchItem.query_params && "mtgsig" in fetchItem.query_params) {
    throw new Error(`${at}.query_params.mtgsig 已不再支持：改为 "sign": "${CallApiSign.Mtgsig}"`);
  }
  if ((fetchItem.mode as string) === "fliggySign") {
    throw new Error(`${at}.mode "fliggySign" 已不再支持：改为 "mode": "${CallApiMode.Mtop}"`);
  }
  if (fetchItem.mode !== undefined && !MODES.includes(fetchItem.mode)) {
    throw new Error(`${at}.mode 不支持 ${JSON.stringify(fetchItem.mode)}，可选：${MODES.join(" / ")}`);
  }
  if (fetchItem.sign !== undefined && !SIGNS.includes(fetchItem.sign)) {
    throw new Error(`${at}.sign 不支持 ${JSON.stringify(fetchItem.sign)}，可选：${SIGNS.join(" / ")}`);
  }
  if (fetchItem.sign && fetchItem.mode === CallApiMode.Mtop) {
    throw new Error(`${at}: mode "${CallApiMode.Mtop}" 由页面自带验签，不能再配 sign`);
  }
}

async function sendOne(
  tabId: number,
  variables: Record<string, unknown>,
  fetchItem: CallApiParam,
  emit: EmitFn,
): Promise<unknown> {
  const { newUrl, newBody, newHeaders, newPayload } = await transformCallApiParams(variables, fetchItem);
  const method = (fetchItem.method || "GET").toUpperCase();

  if (fetchItem.mode === CallApiMode.Mtop) {
    if (newPayload != null && (typeof newPayload !== "object" || Array.isArray(newPayload))) {
      throw new Error(`mode "${CallApiMode.Mtop}" 的 payload 须为对象（字段展开为 mtopRequest 入参）`);
    }
    emit(`mtop: ${newUrl}`);
    return requestMtop(tabId, {
      api: newUrl,
      headers: newHeaders,
      ...((newPayload as Record<string, unknown>) ?? {}),
    });
  }

  let headers = newHeaders;
  if (fetchItem.sign === CallApiSign.Mtgsig) {
    headers = { ...headers, ...(await signMtgsig(tabId, { url: newUrl, method, body: newBody })) };
  }
  emit(`pageFetch: ${method} ${newUrl}${fetchItem.sign ? `（${fetchItem.sign} 签名）` : ""}`);
  const res = await pageFetch(tabId, newUrl, { method, headers, body: newBody });
  if (!res.ok) {
    throw new Error(`fetch ${fetchItem.url} failed: ${JSON.stringify(res)}`);
  }
  return res.body;
}

/**
 * 在宿主页发请求；采集靠 networkInterceptor → updateData。
 * 返回响应体（call_api_params 为数组时按顺序组成数组），由步骤的 save_as 写入变量。
 */
export async function handleApiFetch(
  tabId: number | null,
  collector: Collector,
  workflowItem: WorkflowItem,
  emit: EmitFn,
  token?: CancelToken | null,
): Promise<unknown> {
  if (tabId == null) throw new Error("call_api 前需要先 navigate 打开宿主页");
  const raw = workflowItem.call_api_params;
  if (!raw) return undefined;
  const params = Array.isArray(raw) ? raw : [raw];
  params.forEach(assertCallApiParam);

  const results: unknown[] = [];
  for (const fetchItem of params) {
    results.push(await sendOne(tabId, collector.variables, fetchItem, emit));
    // 对齐 CommentCollectHandler：random * 3000 + 2000
    await cancellableSleep(Math.random() * 3000 + 2000, token);
  }
  return Array.isArray(raw) ? results : results[0];
}
