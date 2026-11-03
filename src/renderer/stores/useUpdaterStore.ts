import { create } from "zustand";

type UpdaterState = {
  version: string;
  packaged: boolean;
  busy: boolean;
  status: string;
  canDownload: boolean;
  checking: boolean;
  inited: boolean;
  init: () => void;
  refreshMeta: () => Promise<void>;
  check: () => Promise<void>;
  download: () => Promise<void>;
};

let unsub: (() => void) | null = null;

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  version: "",
  packaged: false,
  busy: false,
  status: "尚未检查",
  canDownload: false,
  checking: false,
  inited: false,

  init: () => {
    if (get().inited) return;
    unsub?.();
    unsub = window.updateApi.onStatus((event) => {
      set({ status: event.message, busy: event.busy ?? false });
      if (event.kind === "available") set({ canDownload: true });
    });
    void get().refreshMeta();
    set({ inited: true });
  },

  refreshMeta: async () => {
    const meta = await window.updateApi.meta();
    set({ version: meta.version, packaged: meta.packaged, busy: meta.busy });
  },

  check: async () => {
    set({ checking: true, canDownload: false, status: "检查中…" });
    try {
      const res = await window.updateApi.check();
      set({ status: res.ok ? res.message : res.error });
    } finally {
      await get().refreshMeta();
      set({ checking: false });
    }
  },

  download: async () => {
    set({ canDownload: false });
    const res = await window.updateApi.download();
    set({ status: res.ok ? res.message : res.error, canDownload: !res.ok });
  },
}));
