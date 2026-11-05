import { ipcMain } from "electron";
import { requestLogs } from "../diagnostics/requestLogs";

export function registerRequestLogsIpc(): void {
  ipcMain.handle("requestLogs:read", () => ({
    ok: true,
    data: requestLogs.list(),
  }));
  ipcMain.handle("requestLogs:clear", () => {
    requestLogs.clear();
    return { ok: true, data: undefined };
  });
}
