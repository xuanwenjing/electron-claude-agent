import { desc, sql } from "drizzle-orm";

import { getDb } from "./client";
import { crawlResults } from "./schema";

/** 列表 / IPC 只带预览，避免把数 MB 的 payload 灌进渲染进程 */
const PAYLOAD_PREVIEW_CHARS = 2000;

export type CrawlResultDto = {
  id: number;
  taskId: string;
  ok: boolean;
  payload: string;
  payloadBytes: number;
  truncated: boolean;
  error: string | null;
  createdAt: string;
};

function toDto(row: {
  id: number;
  taskId: string;
  ok: boolean;
  payload: string;
  error: string | null;
  createdAt: Date;
}): CrawlResultDto {
  const payloadBytes = Buffer.byteLength(row.payload, "utf8");
  const truncated = row.payload.length > PAYLOAD_PREVIEW_CHARS;
  return {
    id: row.id,
    taskId: row.taskId,
    ok: row.ok,
    payload: truncated ? row.payload.slice(0, PAYLOAD_PREVIEW_CHARS) : row.payload,
    payloadBytes,
    truncated,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

export function saveCrawlResult(input: {
  taskId: string;
  ok: boolean;
  data: unknown;
  error?: string | null;
}): CrawlResultDto {
  const row = getDb()
    .insert(crawlResults)
    .values({
      taskId: input.taskId,
      ok: input.ok,
      payload: JSON.stringify(input.data ?? null),
      error: input.error ?? null,
    })
    .returning()
    .get();

  return toDto(row);
}

export function listCrawlResults(limit = 5): CrawlResultDto[] {
  return getDb()
    .select({
      id: crawlResults.id,
      taskId: crawlResults.taskId,
      ok: crawlResults.ok,
      error: crawlResults.error,
      createdAt: crawlResults.createdAt,
      payloadBytes: sql<number>`length(cast(${crawlResults.payload} as blob))`.mapWith(Number),
      payloadChars: sql<number>`length(${crawlResults.payload})`.mapWith(Number),
      payload: sql<string>`substr(${crawlResults.payload}, 1, ${PAYLOAD_PREVIEW_CHARS})`,
    })
    .from(crawlResults)
    .orderBy(desc(crawlResults.id))
    .limit(limit)
    .all()
    .map((row) => {
      const payloadBytes = Number(row.payloadBytes) || 0;
      const truncated = (Number(row.payloadChars) || 0) > PAYLOAD_PREVIEW_CHARS;
      return {
        id: row.id,
        taskId: row.taskId,
        ok: row.ok,
        payload: row.payload,
        payloadBytes,
        truncated,
        error: row.error,
        createdAt: row.createdAt.toISOString(),
      };
    });
}
