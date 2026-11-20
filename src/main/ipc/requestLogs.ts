import { ipcMain } from "electron";
import { clearConsoleLogs, listConsoleLogs } from "../diagnostics/consoleLogs";
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
  ipcMain.handle("requestLogs:readConsole", () => ({
    ok: true,
    data: listConsoleLogs(),
  }));
  ipcMain.handle("requestLogs:clearConsole", () => {
    clearConsoleLogs();
    return { ok: true, data: undefined };
  });
}
