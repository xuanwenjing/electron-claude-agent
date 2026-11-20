import { create } from "zustand";
import type { LogKind, LogLine } from "@/api/types";
import { BRIDGE_PORT } from "../../shared/bridgeProtocol";

type CrawlState = {
  connected: boolean;
  port: number;
  /** 浏览器「加载解压缩的扩展」应选择的目录 */
  extensionDir: string;
  logs: LogLine[];
  reloading: boolean;
  inited: boolean;
  appendLog: (kind: LogKind, text: string) => void;
  clearLogs: () => void;
  init: () => void;
  reloadExtension: () => Promise<void>;
  revealExtensionDir: () => Promise<void>;
};

let unsubs: Array<() => void> = [];

export const useCrawlStore = create<CrawlState>((set, get) => ({
  connected: false,
  port: BRIDGE_PORT,
  extensionDir: "",
  logs: [],
  reloading: false,
  inited: false,

  appendLog: (kind, text) =>
    set((s) => ({
      logs: [
        ...s.logs,
        { id: `${Date.now()}-${Math.random()}`, kind, text, at: Date.now() },
      ].slice(-500),
    })),

  clearLogs: () => set({ logs: [] }),

  init: () => {
    if (get().inited) return;
    for (const u of unsubs) u();
    unsubs = [
      window.crawlApi.onStatus(({ connected, port }) =>
        set({ connected, port }),
      ),
      window.crawlApi.onProgress(({ taskId, message }) => {
        get().appendLog("log", `[crawl ${taskId.slice(0, 8)}] ${message}`);
      }),
    ];
    void window.crawlApi
      .getStatus()
      .then(({ connected, port, extensionDir }) =>
        set({ connected, port, extensionDir }),
      );
    set({ inited: true });
  },

  reloadExtension: async () => {
    set({ reloading: true });
    try {
      const res = await window.crawlApi.reloadExtension();
      if (!res.ok) {
        get().appendLog("error", res.error);
        return;
      }
      get().appendLog(
        "log",
        `已下发扩展重载任务 ${res.taskId}（将清空队列并 runtime.reload）`,
      );
    } finally {
      set({ reloading: false });
    }
  },

  revealExtensionDir: async () => {
    const res = await window.crawlApi.revealExtensionDir();
    if (!res.ok) get().appendLog("error", `打开扩展目录失败: ${res.error}`);
  },
}));
