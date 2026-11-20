export type CrawlLogEntry = { at: string; message: string };

/** crawl:start resolves with the final result, including startup/validation failures. */
export type CrawlResult = {
  taskId?: string;
  ok: boolean;
  data?: unknown;
  error?: string | null;
  errorCode?: string | null;
  report?: {
    taskId?: string;
    clientTaskCode?: string;
    businessType?: string;
    ok: boolean;
    error: string | null;
    errorCode: string | null;
    data: unknown;
    config: unknown;
    logs: CrawlLogEntry[];
    savedAt: string;
  } | null;
};

type OpenResult = { ok: true } | { ok: false; error: string };

export type CrawlApi = {
  getStatus: () => Promise<{ connected: boolean; port: number; extensionDir: string }>;
  revealExtensionDir: () => Promise<OpenResult>;
  start: (config: unknown, taskId: string) => Promise<CrawlResult>;
  cancel: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
  reloadExtension: () => Promise<{ ok: true; taskId: string } | { ok: false; error: string }>;
  openUrl: (url: string) => Promise<OpenResult>;
  onStatus: (handler: (data: { connected: boolean; port: number }) => void) => () => void;
  onProgress: (handler: (data: { taskId: string; message: string }) => void) => () => void;
};
