/**
 * 步骤级网络捕获上下文：页面请求命中本步 capture 规则时写入变量，并记下本步已命中的变量名
 */
import type { Collector, EmitFn, WorkflowItem, XhrCapturePayload } from "../types";
import { urlMatch } from "../util";
import { captureNetworkHit, captureRules } from "../variables";

interface ActiveCapture {
  matchApiList: string[];
  workflowItem: WorkflowItem;
  collector: Collector;
  emit: EmitFn;
  /** 本次绑定后已命中的 capture 变量名 */
  hits: Set<string>;
}

/** 任务标签 tabId → 该任务当前步骤的捕获上下文；并行任务各绑各的标签，按请求来源标签分发 */
const captures = new Map<number, ActiveCapture>();

function parseCookieToObject(cookieStr?: string): Record<string, string> {
  if (!cookieStr) return {};
  return String(cookieStr)
    .split(";")
    .reduce<Record<string, string>>((acc, item) => {
      const trimmed = item.trim();
      if (!trimmed) return acc;
      const eq = trimmed.indexOf("=");
      if (eq === -1) {
        acc[trimmed] = "";
        return acc;
      }
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1);
      if (key) acc[key] = value;
      return acc;
    }, {});
}

function parseBody(body: unknown): unknown {
  if (body == null || body === "") return {};
  if (typeof body === "object") return body;
  try {
    return JSON.parse(String(body));
  } catch {
    return { raw: String(body) };
  }
}

/** 每次绑定都清空已命中记录（navigate 重新打开页面也会重新绑定） */
export function setNetworkCaptureContext(opts: {
  tabId: number;
  workflowItem: WorkflowItem;
  collector: Collector;
  emit?: EmitFn;
}): void {
  captures.set(opts.tabId, {
    matchApiList: captureRules(opts.workflowItem),
    workflowItem: opts.workflowItem,
    collector: opts.collector,
    emit: opts.emit || (() => {}),
    hits: new Set(),
  });
}

export function clearNetworkCaptureContext(tabId: number): void {
  captures.delete(tabId);
}

/** 本步（最近一次绑定后）已命中的 capture 变量名 */
export function getCaptureHits(tabId: number): ReadonlySet<string> {
  return captures.get(tabId)?.hits ?? new Set();
}

export function onXhrResponse(data: XhrCapturePayload | undefined, senderTabId?: number): void {
  if (senderTabId == null || !data?.api) return;
  const capture = captures.get(senderTabId);
  if (!capture) return;

  const { matchApiList, workflowItem, collector, emit, hits } = capture;
  if (!matchApiList.length) return;
  if (!matchApiList.some((pattern) => urlMatch(data.api, pattern))) return;

  emit(`网络命中: ${data.method || "GET"} ${data.api}`);
  const names = captureNetworkHit(
    collector,
    workflowItem,
    {
      requestData: parseBody(data.body),
      responseData: data.response,
      api: data.api,
      method: data.method,
      headers: data.headers || {},
      cookies: parseCookieToObject(data.cookie),
    },
    emit,
  );
  names.forEach((name) => hits.add(name));
}
