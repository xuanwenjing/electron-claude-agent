import fs from "node:fs";
import path from "node:path";

import { app, ipcMain } from "electron";

/** 登录启动时带上，用来把窗口隐藏到托盘。Electron 的 wasOpenedAtLogin 在 Windows 上不可用。 */
const OPEN_AT_LOGIN_ARG = "--open-at-login";
const PREF_FILE = "open-at-login";

export type OpenAtLoginState = {
  supported: boolean;
  openAtLogin: boolean;
};

function supported(): boolean {
  return process.platform === "win32" && app.isPackaged;
}

function prefPath(): string {
  return path.join(app.getPath("userData"), PREF_FILE);
}

/** 没写过偏好时默认开启 */
function readEnabled(): boolean {
  try {
    return fs.readFileSync(prefPath(), "utf8").trim() !== "0";
  } catch {
    return true;
  }
}

function apply(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    enabled,
    args: enabled ? [OPEN_AT_LOGIN_ARG] : [],
  });
}

/** 按已保存的偏好写入注册表。每次启动都写，更新换路径后仍指向当前 exe */
export function applyOpenAtLogin(): void {
  if (!supported()) return;
  apply(readEnabled());
}

export function launchedAtLogin(argv: readonly string[] = process.argv): boolean {
  return argv.includes(OPEN_AT_LOGIN_ARG);
}

export function getOpenAtLoginState(): OpenAtLoginState {
  if (!supported()) return { supported: false, openAtLogin: false };
  return { supported: true, openAtLogin: readEnabled() };
}

export function setOpenAtLogin(enabled: boolean): OpenAtLoginState {
  if (!supported()) return { supported: false, openAtLogin: false };
  fs.writeFileSync(prefPath(), enabled ? "1" : "0");
  apply(enabled);
  return { supported: true, openAtLogin: enabled };
}

export function registerAutoLaunchIpc(): void {
  ipcMain.handle("app:getOpenAtLogin", () => getOpenAtLoginState());
  ipcMain.handle("app:setOpenAtLogin", (_event, enabled: unknown) => setOpenAtLogin(enabled === true));
}
