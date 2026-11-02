import fs from "node:fs";
import path from "node:path";

import type { TaskErrorCode } from "../../shared/bridgeProtocol";
import { ensureWorkspaceDir } from "../utils/paths";

export interface CrawlLogEntry {
  at: string;
  message: string;
}

/** 写入 workspace/crawl/<taskId>/result.json，返回绝对路径 */
export function writeCrawlResultFile(input: {
  taskId: string;
  ok: boolean;
  data?: unknown;
  error?: string | null;
  errorCode?: TaskErrorCode | null;
  config?: unknown;
  logs?: CrawlLogEntry[];
}): string {
  const safeId = input.taskId.replace(/[^a-zA-Z0-9_-]/g, "") || "task";
  const dir = path.join(ensureWorkspaceDir(), "crawl", safeId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "result.json");
  const body = {
    taskId: input.taskId,
    ok: input.ok,
    error: input.error ?? null,
    errorCode: input.errorCode ?? null,
    data: input.data ?? null,
    config: input.config ?? null,
    logs: input.logs ?? [],
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2), "utf8");
  return file;
}
