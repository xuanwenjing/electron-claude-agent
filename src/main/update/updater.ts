import path from "node:path";
import { app } from "electron";
import { autoUpdater as defaultUpdater, NsisUpdater } from "electron-updater";
import { DownloadedUpdateHelper } from "electron-updater/out/DownloadedUpdateHelper";

class WindowsUpdater extends NsisUpdater {
  constructor() {
    super();
    // Use the same helper for downloads, cached metadata and installer lookup.
    // This protected hook/internal helper is covered by updater-cache.test.cjs.
    this.downloadedUpdateHelper = new DownloadedUpdateHelper(
      path.join(app.getPath("userData"), "updates"),
    );
  }
}

export const autoUpdater = process.platform === "win32"
  ? new WindowsUpdater()
  : defaultUpdater;
