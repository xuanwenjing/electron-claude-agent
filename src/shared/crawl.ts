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
    logs: { at: string; message: string }[];
    savedAt: string;
  } | null;
};
