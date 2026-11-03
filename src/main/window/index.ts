import { BrowserWindow } from "electron";
import path from "node:path";

import { consumeLaunchWithoutFocus } from "../update/appUpdater";
import { launchedAtLogin } from "./autoLaunch";
import { setupWindowsTray } from "./tray";

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export function sendToRenderer(channel: string, data: unknown): void {
  mainWindow?.webContents.send(channel, data);
}

export function createMainWindow(): void {
  const startInBackground = consumeLaunchWithoutFocus() || launchedAtLogin();
  const startInTray = process.platform === "win32" && startInBackground;
  mainWindow = new BrowserWindow({
    width: 980,
    height: 920,
    show: !startInTray,
    webPreferences: {
      preload: path.join(__dirname, "../../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Remove the Windows menu bar while keeping native window controls.
  if (process.platform === "win32") mainWindow.removeMenu();

  void setupWindowsTray(mainWindow, { startHidden: startInTray });

  mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
