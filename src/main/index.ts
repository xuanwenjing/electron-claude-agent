import { app, BrowserWindow } from "electron";

import { killAllPython } from "./agent/pythonMcp";
import { stopBridgeServer } from "./crawl/bridgeServer";
import { closeDatabase, initDatabase } from "./db";
import { loadEnvFiles, loadUserDataEnv } from "./env";
import { registerIpcHandlers, startCrawlBridge } from "./ipc";
import { startUpdaters } from "./update";
import { createMainWindow } from "./window";

loadEnvFiles();

app.whenReady().then(() => {
  loadUserDataEnv();

  initDatabase();
  registerIpcHandlers();
  startCrawlBridge();
  startUpdaters();
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  killAllPython();
  stopBridgeServer();
  closeDatabase();
});
