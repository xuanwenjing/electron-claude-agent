import { create } from "zustand";
import type { LogKind, LogLine } from "@/api/types";

const DEFAULT_PROMPT = `只用 mcp__python__run_python（不要用 Bash / PowerShell），用 Python 实现下面这些常见 shell 命令的效果，每步单独调用一次：
1. pwd / uname / which python / python --version：打印当前目录、系统平台、sys.executable、sys.version
2. ls -la：列出工作区顶层条目，显示类型、大小、修改时间
3. find + du：递归统计工作区文件总数、总大小，列出最大的 5 个文件
4. cat / head / wc -l：读取 sample.txt，打印前 5 行和总行数
5. grep -rn：在工作区所有 .md / .txt 文件中搜索关键字 "workspace"，打印 文件:行号:内容（最多 10 条）
6. date / env：打印本地时间、时区，以及环境变量 PATH 的前 3 项
7. mkdir -p / cp / mv / rm：在 tmp-python/shell-demo/ 下建目录、写入文件、复制、重命名，再删除整个 shell-demo 目录，每步打印结果
最后用表格汇总：步骤、对应 shell 命令、是否成功、关键输出。`;

type AgentState = {
  prompt: string;
  running: boolean;
  stopping: boolean;
  logs: LogLine[];
  inited: boolean;
  setPrompt: (prompt: string) => void;
  clearLogs: () => void;
  appendLog: (kind: LogKind, text: string) => void;
  init: () => void;
  run: () => Promise<void>;
  stop: () => Promise<void>;
};

let unsub: (() => void) | null = null;

export const useAgentStore = create<AgentState>((set, get) => ({
  prompt: DEFAULT_PROMPT,
  running: false,
  stopping: false,
  logs: [],
  inited: false,

  setPrompt: (prompt) => set({ prompt }),

  clearLogs: () => set({ logs: [] }),

  appendLog: (kind, text) =>
    set((s) => ({
      logs: [
        ...s.logs,
        { id: `${Date.now()}-${Math.random()}`, kind, text, at: Date.now() },
      ].slice(-500),
    })),

  init: () => {
    if (get().inited) return;
    unsub?.();
    unsub = window.agentApi.onEvent((event) => {
      get().appendLog(event.kind, event.text);
    });
    set({ inited: true });
  },

  run: async () => {
    const prompt = get().prompt.trim();
    if (!prompt) {
      get().appendLog("error", "请输入 prompt");
      return;
    }
    set({ running: true, stopping: false });
    get().appendLog("log", "开始运行…");
    try {
      const res = await window.agentApi.run(prompt);
      if (res.ok) get().appendLog("result", `完成\n${res.result}`);
      else if ("stopped" in res && res.stopped) {
        /* 主进程已推送「已停止」日志 */
      } else get().appendLog("error", res.error);
    } catch (err) {
      get().appendLog("error", err instanceof Error ? err.message : String(err));
    } finally {
      set({ running: false, stopping: false });
    }
  },

  stop: async () => {
    if (!get().running || get().stopping) return;
    set({ stopping: true });
    try {
      const res = await window.agentApi.stop();
      if (!res.ok) {
        get().appendLog("error", res.error);
        set({ stopping: false });
      }
    } catch (err) {
      get().appendLog("error", err instanceof Error ? err.message : String(err));
      set({ stopping: false });
    }
  },
}));
