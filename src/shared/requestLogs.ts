export type RequestLog = {
  id: number;
  startedAt: string;
  method: string;
  url: string;
  request: string;
  response?: string;
  status?: number;
  durationMs?: number;
  state: "pending" | "success" | "error";
};
export type LogResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };
export type RequestLogsApi = {
  read: () => Promise<LogResult<RequestLog[]>>;
  clear: () => Promise<LogResult>;
};
