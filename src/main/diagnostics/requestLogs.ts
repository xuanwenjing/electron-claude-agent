import type { RequestLog } from "../../shared/requestLogs";

export function formatLogValue(value: unknown): string {
  const ancestors: object[] = [];
  try {
    return (
      JSON.stringify(
        value,
        function (_key, item: unknown) {
          if (typeof item === "bigint") return String(item);
          if (!item || typeof item !== "object") return item;
          while (ancestors.length && ancestors[ancestors.length - 1] !== this)
            ancestors.pop();
          if (ancestors.includes(item)) return "[循环引用]";
          ancestors.push(item);
          return item;
        },
        2,
      ) ?? ""
    );
  } catch {
    return "[无法展示该内容]";
  }
}

function requestUrl(url: string, baseURL?: string): string {
  try {
    return new URL(url, baseURL).toString();
  } catch {
    return url;
  }
}

export class RequestLogStore {
  private entries: RequestLog[] = [];
  private nextId = 0;
  begin(config: {
    url?: string;
    baseURL?: string;
    method?: string;
    params?: unknown;
    data?: unknown;
    headers?: unknown;
  }): number {
    const id = ++this.nextId;
    this.entries.push({
      id,
      startedAt: new Date().toISOString(),
      method: (config.method || "GET").toUpperCase(),
      url: requestUrl(config.url || "", config.baseURL),
      request: formatLogValue({
        params: config.params,
        body: config.data,
        headers: config.headers,
      }),
      state: "pending",
    });
    this.entries = this.entries.slice(-50);
    return id;
  }
  finish(
    id: number,
    result: {
      status?: number;
      body: unknown;
      durationMs: number;
      failed: boolean;
    },
  ): void {
    const entry = this.entries.find((item) => item.id === id);
    if (entry)
      Object.assign(entry, {
        status: result.status,
        response: formatLogValue(result.body),
        durationMs: result.durationMs,
        state: result.failed ? "error" : "success",
      });
  }
  list(): RequestLog[] {
    return this.entries.map((entry) => ({ ...entry }));
  }
  clear(): void {
    this.entries = [];
  }
}
export const requestLogs = new RequestLogStore();
