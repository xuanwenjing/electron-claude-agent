import type { AuthApi } from "../../shared/auth";
import type { CrawlApi } from "../../shared/crawl";
import type { RequestApi } from "../../shared/request";
import type { RequestLogsApi } from "../../shared/requestLogs";
import type { UpdateApi } from "../../shared/update";

export type LogKind = "log" | "error";

export type LogLine = {
  id: string;
  kind: LogKind;
  text: string;
  at: number;
};

declare global {
  interface Window {
    requestLogsApi: RequestLogsApi;
    authApi: AuthApi;
    requestApi: RequestApi;
    crawlApi: CrawlApi;
    updateApi: UpdateApi;
  }
}

export {};
