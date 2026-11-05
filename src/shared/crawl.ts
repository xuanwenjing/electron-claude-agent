/** crawl:start resolves with the final result, including startup/validation failures. */
export type CrawlResult = {
  taskId?: string;
  ok: boolean;
  data?: unknown;
  error?: string | null;
  errorCode?: string | null;
  resultPath?: string | null;
};
