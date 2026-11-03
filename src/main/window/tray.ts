import { app, autoUpdater, Tray, type BrowserWindow } from "electron";

/** Keep the Windows window alive until the user exits or an update quits the app. */
export async function setupWindowsTray(win: BrowserWindow): Promise<void> {
  if (process.platform !== "win32") return;

  // Event handlers retain the tray for the lifetime of this window.
  let tray: Tray | null = null;
  let isQuitting = false;
  const allowQuit = () => { isQuitting = true; };
  app.on("before-quit", allowQuit);
  // electron-updater also emits this event on Electron's native autoUpdater.
  autoUpdater.on("before-quit-for-update", allowQuit);
  win.on("session-end", allowQuit);

  win.on("close", (event) => {
    if (!isQuitting && tray && !tray.isDestroyed()) {
      event.preventDefault();
      win.hide();
    }
  });
  win.once("closed", () => {
    app.removeListener("before-quit", allowQuit);
    autoUpdater.removeListener("before-quit-for-update", allowQuit);
    tray?.destroy();
    tray = null;
  });

  try {
    // Uses the installed executable's icon; no separate asset path to package.
    const icon = await app.getFileIcon(process.execPath, { size: "small" });
    if (win.isDestroyed() || isQuitting) return;
    if (icon.isEmpty()) throw new Error("Application tray icon is empty");

    tray = new Tray(icon);
    tray.setToolTip("ElectronClaudeAgent");
    const showWindow = () => {
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    };
    tray.on("click", showWindow);
    tray.on("double-click", showWindow);
  } catch (error) {
    // Keep normal closing available if Windows cannot create the tray.
    tray?.destroy();
    tray = null;
    console.error("Failed to create Windows tray", error);
  }
}
