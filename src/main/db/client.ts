import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import * as schema from "./schema";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

let sqlite: Database.Database | null = null;
let db: AppDatabase | null = null;
let dbFilePath = "";

function ensureSchema(raw: Database.Database): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crawl_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      ok INTEGER NOT NULL,
      payload TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL
    );
  `);
}

/** 在 app ready 后调用。库文件位于 userData，卸载 .app 通常不会删。 */
export function initDatabase(): AppDatabase {
  if (db) return db;

  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  dbFilePath = path.join(dir, "app.db");

  sqlite = new Database(dbFilePath);
  sqlite.pragma("journal_mode = WAL");
  ensureSchema(sqlite);

  db = drizzle(sqlite, { schema });
  return db;
}

export function getDb(): AppDatabase {
  if (!db) {
    throw new Error("数据库未初始化，请先调用 initDatabase()");
  }
  return db;
}

export function getDbPath(): string {
  return dbFilePath;
}

export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    db = null;
  }
}
