export type AgentProgressEvent = {
  kind: "log" | "assistant" | "tool" | "result" | "error";
  text: string;
};

export type NoteDto = {
  id: number;
  content: string;
  createdAt: string;
};

export type UpdateStatusEvent = {
  kind:
    | "checking"
    | "available"
    | "not-available"
    | "progress"
    | "downloaded"
    | "error"
    | "disabled";
  message: string;
  version?: string;
  percent?: number;
};

export type CrawlResultRow = {
  id: number;
  taskId: string;
  ok: boolean;
  payload: string;
  payloadBytes: number;
  truncated: boolean;
  error: string | null;
  createdAt: string;
};

export type CrawlResultEvent = {
  taskId: string;
  ok: boolean;
  data?: unknown;
  error?: string | null;
  saved?: unknown;
};

export type LogKind = "log" | "assistant" | "tool" | "result" | "error";

export type LogLine = {
  id: string;
  kind: LogKind;
  text: string;
  at: number;
};

declare global {
  interface Window {
    agentApi: {
      run: (
        prompt: string,
      ) => Promise<
        { ok: true; result: string } | { ok: false; error: string; stopped?: boolean }
      >;
      stop: () => Promise<{ ok: true } | { ok: false; error: string }>;
      onEvent: (handler: (event: AgentProgressEvent) => void) => () => void;
    };
    dbApi: {
      info: () => Promise<
        { ok: true; path: string; count: number } | { ok: false; error: string }
      >;
      listNotes: () => Promise<{ ok: true; notes: NoteDto[] } | { ok: false; error: string }>;
      addNote: (
        content: string,
      ) => Promise<{ ok: true; note: NoteDto } | { ok: false; error: string }>;
      deleteNote: (id: number) => Promise<{ ok: true } | { ok: false; error: string }>;
      clearNotes: () => Promise<{ ok: true; deleted: number } | { ok: false; error: string }>;
    };
    crawlApi: {
      getStatus: () => Promise<{ connected: boolean; port: number }>;
      start: (
        config: unknown,
      ) => Promise<{ ok: true; taskId: string } | { ok: false; error: string }>;
      reloadExtension: () => Promise<
        { ok: true; taskId: string } | { ok: false; error: string }
      >;
      openXiaohongshu: () => Promise<{ ok: true } | { ok: false; error: string }>;
      listResults: () => Promise<
        { ok: true; rows: CrawlResultRow[] } | { ok: false; error: string }
      >;
      onStatus: (handler: (data: { connected: boolean; port: number }) => void) => () => void;
      onProgress: (handler: (data: { taskId: string; message: string }) => void) => () => void;
      onResult: (handler: (data: CrawlResultEvent) => void) => () => void;
    };
    updateApi: {
      meta: () => Promise<{ version: string; packaged: boolean }>;
      check: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
      download: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
      onStatus: (handler: (event: UpdateStatusEvent) => void) => () => void;
    };
  }
}

export {};
