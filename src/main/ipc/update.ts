import { ipcMain } from "electron";

import { checkForAppUpdates, downloadAppUpdate, getUpdateMeta } from "../update/appUpdater";

export function registerUpdateIpc(): void {
  ipcMain.handle("update:meta", () => getUpdateMeta());
  ipcMain.handle("update:check", () => checkForAppUpdates());
  ipcMain.handle("update:download", () => downloadAppUpdate());
}
