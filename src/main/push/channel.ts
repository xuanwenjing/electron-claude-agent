/**
 * 登录后的 SSE 推送通道。行为对齐 chat-sse-channel：
 * GET /channel/subscribe。连接还在时不重试，即使事件内容不规范。
 * 流一旦断开就重连，直到退出或更换令牌、门店。
 * 不带 conversation_id；身份放在 Device-Number、Outlet-Code、Authorization、Source。
 */

import { requestLogs } from "../diagnostics/requestLogs";

export const PUSH_SOURCE = "omnivista-reply";
export const PUSH_SUBSCRIBE_PATH = "/channel/subscribe";

export type PushEvent = { event: string; connection_id?: string } & Record<
  string,
  unknown
>;

export type PushFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; body: ReadableStream<Uint8Array> | null }>;

type ReconnectOptions = {
  maxAttempts: number;
  delayMs: number;
  exponentialBackoff: boolean;
  backoffFactor: number;
  maxDelayMs: number;
  jitter: number;
};

const defaultReconnect: ReconnectOptions = {
  maxAttempts: Infinity,
  delayMs: 1000,
  exponentialBackoff: true,
  backoffFactor: 2,
  maxDelayMs: 60_000,
  jitter: 0.1,
};

export function pushUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${PUSH_SUBSCRIBE_PATH}`;
}

export function pushHeaders(input: {
  deviceNumber: string;
  outletCode: string;
  token: string;
}): Record<string, string> {
  const authorization = /^Bearer\s+/i.test(input.token)
    ? input.token
    : `Bearer ${input.token}`;
  return {
    Accept: "text/event-stream",
    Source: PUSH_SOURCE,
    "Device-Number": input.deviceNumber,
    "Outlet-Code": input.outletCode,
    Authorization: authorization,
  };
}

async function readStreamText(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return text;
  }
  return text;
}

/** 从缓冲区取出已结束的 SSE 事件（以空行分隔，只认 data: 行）。 */
export function takeSseEvents(buffer: string): { events: PushEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: PushEvent[] = [];
  for (const part of parts) {
    const data = part
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as { event?: unknown }).event !== "string"
    ) {
      continue;
    }
    events.push(parsed as PushEvent);
  }
  return { events, rest };
}

export function reconnectDelayMs(attempt: number, options: ReconnectOptions): number {
  let delay = options.exponentialBackoff
    ? Math.min(
        options.delayMs * options.backoffFactor ** (attempt - 1),
        options.maxDelayMs,
      )
    : options.delayMs;
  if (options.jitter > 0) {
    const jitter = Math.min(Math.max(options.jitter, 0), 1);
    const spread = delay * jitter;
    delay = delay - spread + Math.random() * spread;
  }
  return Math.max(0, Math.round(delay));
}

export type PushSubscription = {
  unsubscribe: () => void;
  isActive: () => boolean;
  getConnectionId: () => string | undefined;
};

export function subscribePushChannel(
  input: {
    baseUrl: string;
    deviceNumber: string;
    outletCode: string;
    token: string;
    fetchImpl?: PushFetch;
    reconnect?: Partial<ReconnectOptions>;
  },
  handlers: {
    onConnection?: (connectionId: string) => void;
    onMessage?: (event: PushEvent) => void;
    onError?: (error: unknown) => void;
  } = {},
): PushSubscription {
  const reconnect = { ...defaultReconnect, ...input.reconnect };
  const abortController = new AbortController();
  let connectionId: string | undefined;
  let active = true;
  let attempts = 0;
  let openedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const teardown = () => {
    if (!active) return;
    active = false;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    abortController.abort();
  };

  const scheduleReconnect = () => {
    if (!active) return;
    if (attempts >= reconnect.maxAttempts) {
      teardown();
      handlers.onError?.(
        new Error(`推送通道重连次数已用尽（${reconnect.maxAttempts}）`),
      );
      return;
    }
    if (openedAt && Date.now() - openedAt >= reconnect.maxDelayMs) attempts = 0;
    openedAt = 0;
    attempts += 1;
    const delay = reconnectDelayMs(attempts, reconnect);
    timer = setTimeout(() => {
      timer = undefined;
      if (active) void openStream();
    }, delay);
    timer.unref?.();
  };

  const dispatch = (event: PushEvent) => {
    if (event.event === "connection") {
      if (typeof event.connection_id === "string") {
        connectionId = event.connection_id;
        handlers.onConnection?.(event.connection_id);
      }
      return;
    }
    if (event.event === "heartbeat") return;
    handlers.onMessage?.(event);
  };

  const openStream = async () => {
    const fetchImpl = input.fetchImpl ?? fetch;
    const started = Date.now();
    const url = pushUrl(input.baseUrl);
    const headers = pushHeaders(input);
    const logId = requestLogs.begin({ method: "GET", url, headers });
    let raw = "";
    const writeLog = (failed: boolean, status?: number) => {
      requestLogs.finish(logId, {
        status,
        body: raw,
        durationMs: Date.now() - started,
        failed,
      });
    };
    let response: Awaited<ReturnType<PushFetch>>;
    try {
      response = await fetchImpl(url, { headers, signal: abortController.signal });
    } catch (error) {
      if (!active || abortController.signal.aborted) return;
      writeLog(true);
      handlers.onError?.(error);
      scheduleReconnect();
      return;
    }
    if (!active || abortController.signal.aborted) return;
    if (!response.ok || !response.body) {
      raw = await readStreamText(response.body);
      writeLog(true, response.status);
      if (!active || abortController.signal.aborted) return;
      handlers.onError?.(new Error(`推送通道连接失败：${response.status}`));
      scheduleReconnect();
      return;
    }

    const reader = response.body.getReader();
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    abortController.signal.addEventListener("abort", cancel);
    const decoder = new TextDecoder();
    let buffer = "";
    openedAt = Date.now();
    writeLog(false, response.status);
    try {
      while (active) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        raw += text;
        buffer += text;
        writeLog(false, response.status);
        const taken = takeSseEvents(buffer);
        buffer = taken.rest;
        for (const event of taken.events) dispatch(event);
      }
      const tail = decoder.decode();
      if (tail) {
        raw += tail;
        buffer += tail;
      }
      if (active && buffer) {
        const taken = takeSseEvents(`${buffer}\n\n`);
        for (const event of taken.events) dispatch(event);
      }
      writeLog(false, response.status);
    } catch (error) {
      if (active && !abortController.signal.aborted) {
        writeLog(false, response.status);
        handlers.onError?.(error);
      }
    } finally {
      abortController.signal.removeEventListener("abort", cancel);
    }
    if (active && !abortController.signal.aborted) scheduleReconnect();
  };

  void openStream();

  return {
    unsubscribe: teardown,
    isActive: () => active,
    getConnectionId: () => connectionId,
  };
}

/** 按当前令牌和门店保持一条连接；门店或令牌变了就换一条，退出则断开。 */
export function createPushSession(options: {
  baseUrl: string;
  deviceNumber: string;
  fetchImpl?: PushFetch;
  reconnect?: Partial<ReconnectOptions>;
  onConnection?: (connectionId: string) => void;
  onMessage?: (event: PushEvent) => void;
  onError?: (error: unknown) => void;
}): {
  sync: (token?: string, outletCode?: string) => void;
  stop: () => void;
} {
  let current: { token: string; outletCode: string; stop: () => void; isActive: () => boolean } | null =
    null;

  const stop = () => {
    const running = current;
    current = null;
    running?.stop();
  };

  return {
    stop,
    sync: (token?: string, outletCode?: string) => {
      if (!token || !outletCode) {
        stop();
        return;
      }
      if (
        current?.token === token &&
        current.outletCode === outletCode &&
        current.isActive()
      ) {
        return;
      }
      stop();
      const subscription = subscribePushChannel(
        {
          baseUrl: options.baseUrl,
          deviceNumber: options.deviceNumber,
          outletCode,
          token,
          fetchImpl: options.fetchImpl,
          reconnect: options.reconnect,
        },
        {
          onConnection: options.onConnection,
          onMessage: options.onMessage,
          onError: options.onError,
        },
      );
      current = {
        token,
        outletCode,
        stop: () => subscription.unsubscribe(),
        isActive: () => subscription.isActive(),
      };
    },
  };
}
