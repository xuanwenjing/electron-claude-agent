import { create } from "zustand";
import type { CrawlResultEvent, CrawlResultRow, LogKind, LogLine } from "@/api/types";
import { BRIDGE_PORT } from "../../shared/bridgeProtocol";
import { SAMPLE_CRAWL_CONFIG } from "../sampleConfig";
import { useNotesStore } from "./useNotesStore";

type CrawlState = {
  connected: boolean;
  port: number;
  configText: string;
  results: CrawlResultRow[];
  logs: LogLine[];
  starting: boolean;
  reloading: boolean;
  inited: boolean;
  setConfigText: (text: string) => void;
  appendLog: (kind: LogKind, text: string) => void;
  clearLogs: () => void;
  init: () => void;
  refreshResults: () => Promise<void>;
  start: () => Promise<void>;
  reloadExtension: () => Promise<void>;
  openXiaohongshu: () => Promise<void>;
};

let unsubs: Array<() => void> = [];

export const useCrawlStore = create<CrawlState>((set, get) => ({
  connected: false,
  port: BRIDGE_PORT,
  configText: JSON.stringify(SAMPLE_CRAWL_CONFIG, null, 2),
  results: [],
  logs: [],
  starting: false,
  reloading: false,
  inited: false,

  setConfigText: (configText) => set({ configText }),

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
      window.crawlApi.onStatus(({ connected, port }) => set({ connected, port })),
      window.crawlApi.onProgress(({ taskId, message }) => {
        get().appendLog("log", `[crawl ${taskId.slice(0, 8)}] ${message}`);
      }),
      window.crawlApi.onResult((raw) => {
        const msg = raw as CrawlResultEvent;
        get().appendLog(
          msg.ok ? "log" : "error",
          `[crawl 结果] ${msg.ok ? "已入库" : msg.error || "失败"}${!msg.ok && msg.errorCode ? ` [${msg.errorCode}]` : ""}${msg.resultPath ? `，已保存 ${msg.resultPath}` : ""}`,
        );
        void get().refreshResults();
        void useNotesStore.getState().refresh();
      }),
    ];
    void window.crawlApi.getStatus().then(({ connected, port }) => set({ connected, port }));
    void get().refreshResults();
    set({ inited: true });
  },

  refreshResults: async () => {
    const res = await window.crawlApi.listResults();
    if (!res.ok) {
      get().appendLog("error", res.error);
      return;
    }
    set({ results: res.rows });
  },

  start: async () => {
    let config: unknown;
    try {
      config = JSON.parse(get().configText);
    } catch (err) {
      get().appendLog(
        "error",
        `抓取配置 JSON 无效: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    set({ starting: true });
    try {
      const res = await window.crawlApi.start(config);
      if (!res.ok) {
        get().appendLog("error", res.error);
        return;
      }
      get().appendLog("log", `已下发抓取任务 ${res.taskId}`);
    } finally {
      set({ starting: false });
    }
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

  openXiaohongshu: async () => {
    const res = await window.crawlApi.openXiaohongshu();
    if (!res.ok) {
      get().appendLog("error", `打开小红书失败: ${res.error}`);
      return;
    }
    get().appendLog("log", "已用 Google Chrome 打开 https://www.xiaohongshu.com");
  },
}));
