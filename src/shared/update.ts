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
  busy?: boolean;
};

type ActionResult = { ok: true; message: string } | { ok: false; error: string };
type OpenAtLoginState = { supported: boolean; openAtLogin: boolean };

export type UpdateApi = {
  meta: () => Promise<{ version: string; packaged: boolean; busy: boolean }>;
  getOpenAtLogin: () => Promise<OpenAtLoginState>;
  setOpenAtLogin: (enabled: boolean) => Promise<OpenAtLoginState>;
  check: () => Promise<ActionResult>;
  download: () => Promise<ActionResult>;
  onStatus: (handler: (event: UpdateStatusEvent) => void) => () => void;
};
