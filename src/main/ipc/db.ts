import { ipcMain } from "electron";

import { addNote, clearNotes, deleteNote, getNotesDbInfo, listCrawlResults, listNotes } from "../db";
import { toErrorMessage } from "./errors";

export function registerDbIpc(): void {
  ipcMain.handle("db:info", () => {
    try {
      return { ok: true as const, ...getNotesDbInfo() };
    } catch (err) {
      return { ok: false as const, error: toErrorMessage(err) };
    }
  });

  ipcMain.handle("db:notes:list", () => {
    try {
      return { ok: true as const, notes: listNotes() };
    } catch (err) {
      return { ok: false as const, error: toErrorMessage(err) };
    }
  });

  ipcMain.handle("db:notes:add", (_event, content: string) => {
    try {
      if (typeof content !== "string") {
        return { ok: false as const, error: "内容必须是字符串" };
      }
      return { ok: true as const, note: addNote(content) };
    } catch (err) {
      return { ok: false as const, error: toErrorMessage(err) };
    }
  });

  ipcMain.handle("db:notes:delete", (_event, id: number) => {
    try {
      if (typeof id !== "number" || !Number.isInteger(id)) {
        return { ok: false as const, error: "id 无效" };
      }
      const deleted = deleteNote(id);
      return deleted
        ? { ok: true as const }
        : { ok: false as const, error: `未找到 id=${id}` };
    } catch (err) {
      return { ok: false as const, error: toErrorMessage(err) };
    }
  });

  ipcMain.handle("db:notes:clear", () => {
    try {
      return { ok: true as const, deleted: clearNotes() };
    } catch (err) {
      return { ok: false as const, error: toErrorMessage(err) };
    }
  });

  ipcMain.handle("db:crawl:list", () => {
    try {
      return { ok: true as const, rows: listCrawlResults(5) };
    } catch (err) {
      return { ok: false as const, error: toErrorMessage(err) };
    }
  });
}
