/**
 * 步骤级网络采集上下文：对齐 CommentCollectHandler.setWorkflowParams + handleXhrResponse
 */
import type { Collector, EmitFn, WorkflowItem, XhrCapturePayload } from "../types";
import { urlMatch } from "../util";
import { captureNetworkHit, captureRules } from "../variables";
import { collectNetworkHit } from "./collector";

interface ActiveCapture {
  matchApiList: string[];
  workflowItem: WorkflowItem;
  collector: Collector;
  emit: EmitFn;
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

export function buildMatchApiList(workflowItem: WorkflowItem): string[] {
  const list: string[] = [];
  if (workflowItem.need_collect && workflowItem.reg_exp) {
    list.push(workflowItem.reg_exp);
  }
  list.push(...captureRules(workflowItem));
  return list;
}

export function setNetworkCaptureContext(opts: {
  tabId: number;
  workflowItem: WorkflowItem;
  collector: Collector;
  emit?: EmitFn;
}): void {
  captures.set(opts.tabId, {
    matchApiList: buildMatchApiList(opts.workflowItem),
    workflowItem: opts.workflowItem,
    collector: opts.collector,
    emit: opts.emit || (() => {}),
  });
}

export function clearNetworkCaptureContext(tabId: number): void {
  captures.delete(tabId);
}

export function onXhrResponse(data: XhrCapturePayload | undefined, senderTabId?: number): void {
  if (senderTabId == null || !data?.api) return;
  const capture = captures.get(senderTabId);
  if (!capture) return;

  const { matchApiList, workflowItem, collector, emit } = capture;
  if (!matchApiList.length) return;
  if (!matchApiList.some((pattern) => urlMatch(data.api, pattern))) return;

  const requestData = parseBody(data.body);
  const responseData = data.response;
  const cookies = parseCookieToObject(data.cookie);

  emit(`网络命中: ${data.method || "GET"} ${data.api}`);
  const payload = {
    requestData,
    responseData,
    api: data.api,
    method: data.method,
    headers: data.headers || {},
    cookies,
  };
  captureNetworkHit(collector, workflowItem, payload, emit);
  collectNetworkHit(collector, workflowItem, payload);
}
