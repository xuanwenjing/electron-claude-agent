import { useAuthStore } from "./useAuthStore";
import { create } from "zustand";
import type { LogKind, LogLine } from "@/api/types";
import { BRIDGE_PORT } from "../../shared/bridgeProtocol";
import { SAMPLE_CRAWL_CONFIG } from "../sampleConfig";

type CrawlState = {
  connected: boolean;
  port: number;
  /** 浏览器「加载解压缩的扩展」应选择的目录 */
  extensionDir: string;
  configText: string;
  logs: LogLine[];
  starting: boolean;
  reloading: boolean;
  inited: boolean;
  setConfigText: (text: string) => void;
  appendLog: (kind: LogKind, text: string) => void;
  clearLogs: () => void;
  init: () => void;
  start: () => Promise<void>;
  reloadExtension: () => Promise<void>;
  revealExtensionDir: () => Promise<void>;
};

let startRequest = 0;
let unsubs: Array<() => void> = [];

export const useCrawlStore = create<CrawlState>((set, get) => ({
  connected: false,
  port: BRIDGE_PORT,
  extensionDir: "",
  configText: JSON.stringify(SAMPLE_CRAWL_CONFIG, null, 2),
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

  start: async () => {
    const outlet = useAuthStore.getState().outlet;
    if (!outlet) return;
    const request = ++startRequest;
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
      if (useAuthStore.getState().outlet !== outlet) return;
      get().appendLog(
        res.ok ? "log" : "error",
        `[crawl ${res.taskId?.slice(0, 8) || "结果"}] ${res.ok ? "抓取完成" : res.error || "失败"}${res.errorCode ? ` [${res.errorCode}]` : ""}${res.resultPath ? `，已保存 ${res.resultPath}` : ""}`,
      );
    } catch (error) {
      get().appendLog("error", `抓取失败: ${String(error)}`);
    } finally {
      if (request === startRequest) set({ starting: false });
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

  revealExtensionDir: async () => {
    const res = await window.crawlApi.revealExtensionDir();
    if (!res.ok) get().appendLog("error", `打开扩展目录失败: ${res.error}`);
  },
}));
