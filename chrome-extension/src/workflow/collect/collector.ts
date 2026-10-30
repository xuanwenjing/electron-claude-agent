import type {
  CollectedArray,
  Collector,
  NetworkUpdatePayload,
  WorkflowItem,
} from "../types";
import { resolveMaybeExpr, urlMatch } from "../util";

export function createCollector(): Collector {
  return {
    data: {},
    variables: {},
    loopPath: [],
  };
}

export function resolveEvent(
  collector: Collector,
  workflowItem: WorkflowItem,
  fallback: string,
): string {
  const raw = workflowItem.event || fallback;
  return String(resolveMaybeExpr(collector.variables, raw));
}

/** 追加一条到 collected[event].content */
export function pushCollected(collector: Collector, event: string, entry: unknown): void {
  if (!collector.data[event]) {
    collector.data[event] = { type: "array", content: [] };
  }
  (collector.data[event] as CollectedArray).content.push(entry);
}

/** need_collect：网络命中（设了 reg_exp 时需匹配）追加到 collected[event] */
export function collectNetworkHit(
  collector: Collector,
  workflowItem: WorkflowItem,
  payload: NetworkUpdatePayload,
): void {
  if (!workflowItem.need_collect) return;
  const { requestData, responseData, api, method, headers, cookies } = payload;
  // 与 networkCapture / urlMatch 一致：逗号表示多规则 OR，不能整段 new RegExp
  if (workflowItem.reg_exp && !urlMatch(api, workflowItem.reg_exp)) return;

  const event = resolveEvent(collector, workflowItem, workflowItem.type || "api");
  pushCollected(collector, event, {
    url: api,
    payload: requestData,
    response: responseData,
    method,
    headers: headers || {},
    cookies: cookies || {},
  });
}

export async function isDataComplete(
  collector: Collector,
  workflowItem: WorkflowItem,
  tabId: number | null,
): Promise<{ success: boolean; errorMessage?: string }> {
  if (!workflowItem.need_collect) return { success: true };
  const event = resolveEvent(collector, workflowItem, "");
  if (!event) return { success: true };
  if (Object.prototype.hasOwnProperty.call(collector.data, event)) {
    return { success: true };
  }
  let pageUrl = "";
  try {
    if (tabId != null) pageUrl = (await chrome.tabs.get(tabId)).url || "";
  } catch {
    /* ignore */
  }
  return {
    success: false,
    errorMessage: `没有采集到需要采集的数据: ${event}${pageUrl ? `，页面URL: ${pageUrl}` : ""}`,
  };
}
