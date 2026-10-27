import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** 演示用笔记表：界面可增删查，验证本地 SQLite */
export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;

/** Chrome 扩展回传的抓取结果 */
export const crawlResults = sqliteTable("crawl_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: text("task_id").notNull(),
  ok: integer("ok", { mode: "boolean" }).notNull(),
  payload: text("payload").notNull(),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type CrawlResult = typeof crawlResults.$inferSelect;
