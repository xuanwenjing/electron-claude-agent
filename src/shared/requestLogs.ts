export type RequestLog = {
  id: number;
  startedAt: string;
  method: string;
  url: string;
  request: string;
  curl: string;
  response?: string;
  status?: number;
  durationMs?: number;
  state: "pending" | "success" | "error";
};
export type ConsoleLog = {
  id: number;
  at: string;
  level: "log" | "info" | "warn" | "error" | "debug";
  message: string;
};
export type LogResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };
export type RequestLogsApi = {
  read: () => Promise<LogResult<RequestLog[]>>;
  clear: () => Promise<LogResult>;
  readConsole: () => Promise<LogResult<ConsoleLog[]>>;
  clearConsole: () => Promise<LogResult>;
};
