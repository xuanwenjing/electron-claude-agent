/**
 * 步骤级网络捕获上下文：页面请求命中本步 capture 规则时写入变量，并记下本步已命中的变量名
 */
import type { Collector, EmitFn, WorkflowItem, XhrCapturePayload } from "../types";
import { urlMatch, urlRuleMismatch } from "../util";
import { captureNetworkHit, captureRules } from "../variables";

/** 每步最多保留的响应记录（capture 超时诊断用） */
const MAX_SEEN_REQUESTS = 50;
/** 诊断日志每类最多列出的请求数 */
const MAX_LISTED_REQUESTS = 10;
const MAX_LOGGED_URL_LENGTH = 200;

interface SeenRequest {
  method: string;
  api: string;
  status?: number;
  code?: unknown;
  error?: string;
}

interface ActiveCapture {
  matchApiList: string[];
  workflowItem: WorkflowItem;
  collector: Collector;
  emit: EmitFn;
  /** 本次绑定后已命中的 capture 变量名 */
  hits: Set<string>;
  /** 本次绑定后收到的响应（只留最近 MAX_SEEN_REQUESTS 个） */
  seen: SeenRequest[];
  seenTotal: number;
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
    seen: [],
    seenTotal: 0,
  });
}

/** 响应体里的业务码（各平台字段名不同） */
function businessCode(response: unknown): unknown {
  if (!response || typeof response !== "object") return undefined;
  const body = response as Record<string, unknown>;
  return body.code ?? body.errcode ?? body.ret;
}

function formatRequest(req: SeenRequest): string {
  const url = req.api.length > MAX_LOGGED_URL_LENGTH ? `${req.api.slice(0, MAX_LOGGED_URL_LENGTH)}…` : req.api;
  const result = req.error ? `失败(${req.error})` : `HTTP ${req.status ?? "?"}`;
  const code = req.code === undefined ? "" : ` code=${JSON.stringify(req.code)}`;
  return `${req.method} ${url} → ${result}${code}`;
}

/** capture 超时的排查信息：规则对应接口的失败请求、路径对上但参数不符的请求、本步最近的响应 */
export function describeCaptureMiss(tabId: number, missing: Record<string, string>): string[] {
  const capture = captures.get(tabId);
  if (!capture?.seenTotal) return ["本步未收到任何 XHR/fetch 响应（页面可能白屏、接口未触发，或拦截脚本未注入）"];
  const { seen, seenTotal } = capture;
  const lines: string[] = [];
  for (const [name, rule] of Object.entries(missing)) {
    const failed = seen.filter((req) => req.error && urlMatch(req.api, rule));
    if (failed.length) {
      lines.push(`${name} 的接口请求失败 ${failed.length} 次：`);
      lines.push(...failed.slice(-MAX_LISTED_REQUESTS).map((req) => `  ${formatRequest(req)}`));
    }
    const near = seen.flatMap((req) => {
      const reason = urlRuleMismatch(req.api, rule);
      return reason ? [`  ${formatRequest(req)}：${reason}`] : [];
    });
    if (near.length) {
      lines.push(`${name} 路径对上但参数不符 ${near.length} 个：`);
      lines.push(...near.slice(-MAX_LISTED_REQUESTS));
    }
  }
  const recent = seen.slice(-MAX_LISTED_REQUESTS);
  lines.push(`本步共收到 ${seenTotal} 个响应${seenTotal > recent.length ? `，最近 ${recent.length} 个` : ""}：`);
  lines.push(...recent.map((req) => `  ${formatRequest(req)}`));
  return lines;
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

  capture.seenTotal++;
  capture.seen.push({
    method: data.method || "GET",
    api: data.api,
    status: data.status,
    code: data.error ? undefined : businessCode(data.response),
    error: data.error,
  });
  if (capture.seen.length > MAX_SEEN_REQUESTS) capture.seen.shift();
  if (data.error) return;

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
