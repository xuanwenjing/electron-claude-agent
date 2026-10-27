import { count, desc, eq } from "drizzle-orm";

import { getDb, getDbPath } from "./client";
import { notes, type Note } from "./schema";

export type NoteDto = {
  id: number;
  content: string;
  createdAt: string;
};

function toDto(row: Note): NoteDto {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

export function listNotes(limit = 50): NoteDto[] {
  const rows = getDb()
    .select()
    .from(notes)
    .orderBy(desc(notes.id))
    .limit(limit)
    .all();
  return rows.map(toDto);
}

export function addNote(content: string): NoteDto {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("笔记内容不能为空");
  }

  const inserted = getDb()
    .insert(notes)
    .values({ content: trimmed })
    .returning()
    .get();

  return toDto(inserted);
}

export function deleteNote(id: number): boolean {
  const result = getDb().delete(notes).where(eq(notes.id, id)).run();
  return result.changes > 0;
}

export function clearNotes(): number {
  const result = getDb().delete(notes).run();
  return result.changes;
}

export function getNotesDbInfo(): { path: string; count: number } {
  const row = getDb().select({ value: count() }).from(notes).get();
  return {
    path: getDbPath(),
    count: row?.value ?? 0,
  };
}
