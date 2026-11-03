import { app } from "electron";

import { killAllPython } from "./agent/pythonMcp";
import { stopBridgeServer } from "./crawl/bridgeServer";
import { closeDatabase, initDatabase } from "./db";
import { loadEnvFiles, loadUserDataEnv } from "./utils/env";
import { registerIpcHandlers, startCrawlBridge } from "./ipc";
import { startUpdaters } from "./update";
import { applyOpenAtLogin, launchedAtLogin } from "./window/autoLaunch";
import { createMainWindow, showMainWindow } from "./window";

// Acquire the lock before initializing the database, bridge port or updaters.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  loadEnvFiles();

  const initialized = app.whenReady().then(() => {
    loadUserDataEnv();

    initDatabase();
    registerIpcHandlers();
    startCrawlBridge();
    startUpdaters();
    applyOpenAtLogin();
    createMainWindow();
  });

  // Queue activation until initial setup completes, including a rapid second launch.
  const activateWindow = () => { void initialized.then(showMainWindow); };
  app.on("second-instance", (_event, commandLine = []) => {
    // A duplicate login launch is background work, not a request to open the UI.
    if (launchedAtLogin(commandLine)) return;
    activateWindow();
  });
  // Dock activation is a macOS interaction; Windows uses second-instance/tray clicks.
  if (process.platform === "darwin") app.on("activate", activateWindow);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    killAllPython();
    stopBridgeServer();
    closeDatabase();
  });
}
