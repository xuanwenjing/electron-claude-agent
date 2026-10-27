import type {
  CollectedArray,
  Collector,
  NetworkUpdatePayload,
  WorkflowItem,
} from "../types";
import { resolveMaybeExpr, safeEval, urlMatch } from "../util";

export function createCollector(): Collector {
  return {
    data: {},
    variables: {},
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

export function updateVariables(
  collector: Collector,
  workflowItem: WorkflowItem,
  payload: NetworkUpdatePayload,
): void {
  if (!workflowItem.global_variables) return;
  const { requestData, responseData, api, method, headers, cookies } = payload;
  const list = Array.isArray(workflowItem.global_variables)
    ? workflowItem.global_variables
    : [workflowItem.global_variables];

  for (const item of list) {
    const varName =
      typeof item.name === "string" && /^\${[\s\S]*}$/.test(item.name.trim())
        ? safeEval(collector.variables, item.name)
        : item.name;

    if (item.url) {
      if (!urlMatch(api, item.url)) continue;
      const queryStr = String(api).split("?")[1] || "";
      const queryParams: Record<string, string> = {};
      if (queryStr) {
        new URLSearchParams(queryStr).forEach((value, key) => {
          queryParams[key] = value;
        });
      }
      collector.variables[String(varName)] = {
        url: item.url,
        method,
        headers: headers || {},
        queryParams,
        payload: requestData || {},
        response: responseData || {},
        cookies: cookies || {},
      };
    } else if (item.value !== undefined && item.value !== null) {
      if (/^\${[\s\S]*}$/.test(String(item.value).trim())) {
        collector.variables[String(varName)] = safeEval(collector.variables, item.value);
      } else {
        collector.variables[String(varName)] = item.value;
      }
    }
  }
}

export function updateData(
  collector: Collector,
  workflowItem: WorkflowItem,
  payload: NetworkUpdatePayload,
): void {
  const { requestData, responseData, api, method, headers, cookies } = payload;
  updateVariables(collector, workflowItem, {
    requestData,
    responseData,
    api,
    method,
    headers,
    cookies,
  });

  if (!workflowItem.need_collect) return;
  // 与 networkCapture / urlMatch 一致：逗号表示多规则 OR，不能整段 new RegExp
  if (workflowItem.reg_exp && !urlMatch(api, workflowItem.reg_exp)) return;

  const event = resolveEvent(collector, workflowItem, workflowItem.type || "api");
  if (!collector.data[event]) {
    collector.data[event] = { type: "array", content: [] };
  }
  const entry = collector.data[event] as CollectedArray;
  entry.content.push({
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
