import { create } from "zustand";
import type { NoteDto } from "@/api/types";

type NotesState = {
  path: string;
  count: number;
  notes: NoteDto[];
  draft: string;
  busy: boolean;
  error: string | null;
  setDraft: (draft: string) => void;
  refresh: () => Promise<void>;
  add: () => Promise<string | null>;
  remove: (id: number) => Promise<string | null>;
  clear: () => Promise<string | null>;
};

export const useNotesStore = create<NotesState>((set, get) => ({
  path: "",
  count: 0,
  notes: [],
  draft: "",
  busy: false,
  error: null,

  setDraft: (draft) => set({ draft }),

  refresh: async () => {
    const info = await window.dbApi.info();
    if (!info.ok) {
      set({ error: info.error });
      return;
    }
    const list = await window.dbApi.listNotes();
    if (!list.ok) {
      set({ error: list.error, path: info.path, count: info.count });
      return;
    }
    set({ path: info.path, count: info.count, notes: list.notes, error: null });
  },

  add: async () => {
    const content = get().draft.trim();
    if (!content) return "请输入笔记内容";
    set({ busy: true });
    try {
      const res = await window.dbApi.addNote(content);
      if (!res.ok) return res.error;
      set({ draft: "" });
      await get().refresh();
      return null;
    } finally {
      set({ busy: false });
    }
  },

  remove: async (id) => {
    const res = await window.dbApi.deleteNote(id);
    if (!res.ok) return res.error;
    await get().refresh();
    return null;
  },

  clear: async () => {
    const res = await window.dbApi.clearNotes();
    if (!res.ok) return res.error;
    await get().refresh();
    return null;
  },
}));
