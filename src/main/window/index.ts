import { BrowserWindow } from "electron";
import path from "node:path";

import { consumeLaunchWithoutFocus } from "../update/appUpdater";
import { launchedAtLogin } from "./autoLaunch";
import { setupWindowsTray } from "./tray";

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function sendToRenderer(channel: string, data: unknown): void {
  mainWindow?.webContents.send(channel, data);
}

export function createMainWindow(): void {
  const startMinimized = consumeLaunchWithoutFocus() || launchedAtLogin();
  mainWindow = new BrowserWindow({
    width: 980,
    height: 920,
    show: !startMinimized,
    webPreferences: {
      preload: path.join(__dirname, "../../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Remove the Windows menu bar while keeping native window controls.
  if (process.platform === "win32") mainWindow.removeMenu();

  void setupWindowsTray(mainWindow);

  mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
  if (startMinimized) {
    const win = mainWindow;
    let startupMinimizeCancelled = false;
    win.on("hide", () => { startupMinimizeCancelled = true; });
    win.on("restore", () => { startupMinimizeCancelled = true; });
    const minimize = () => {
      if (!startupMinimizeCancelled && !win.isDestroyed() && !win.isMinimized()) win.minimize();
    };
    // 安装程序拉起进程时会把窗口激活，准备好后再收一次
    win.once("ready-to-show", () => {
      if (startupMinimizeCancelled || win.isDestroyed()) return;
      win.showInactive();
      minimize();
      setTimeout(minimize, 800);
    });
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
