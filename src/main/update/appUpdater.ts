import { app, dialog, type BrowserWindow } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";

export type UpdateStatusEvent = {
  kind:
    | "checking"
    | "available"
    | "not-available"
    | "progress"
    | "downloaded"
    | "error"
    | "disabled";
  message: string;
  version?: string;
  percent?: number;
};

type GetWindow = () => BrowserWindow | null;

let configured = false;

function send(getWindow: GetWindow, event: UpdateStatusEvent): void {
  getWindow()?.webContents.send("update:status", event);
}

export function setupAutoUpdater(getWindow: GetWindow): void {
  if (configured) return;
  configured = true;

  // 公开 GitHub Release，客户端无需 Token
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    send(getWindow, { kind: "checking", message: "正在检查更新…" });
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    send(getWindow, {
      kind: "available",
      message: `发现新版本 ${info.version}`,
      version: info.version,
    });
  });

  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    send(getWindow, {
      kind: "not-available",
      message: `已是最新版本（当前 ${app.getVersion()}，远端 ${info.version}）`,
      version: info.version,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    send(getWindow, {
      kind: "progress",
      message: `下载中 ${progress.percent.toFixed(1)}%`,
      percent: progress.percent,
    });
  });

  autoUpdater.on("update-downloaded", async (info: UpdateInfo) => {
    send(getWindow, {
      kind: "downloaded",
      message: `更新 ${info.version} 已下载，可重启安装`,
      version: info.version,
    });

    const win = getWindow();
    const boxOpts = {
      type: "info" as const,
      buttons: ["立即重启安装", "稍后"],
      defaultId: 0,
      cancelId: 1,
      title: "更新已就绪",
      message: `新版本 ${info.version} 已下载完成`,
      detail: "未签名的 macOS 包可能无法静默替换，若失败请手动下载 Release 安装。",
    };
    const result = win
      ? await dialog.showMessageBox(win, boxOpts)
      : await dialog.showMessageBox(boxOpts);

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("error", (err) => {
    send(getWindow, {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  });
}

export async function checkForAppUpdates(): Promise<
  { ok: true; message: string } | { ok: false; error: string }
> {
  if (!app.isPackaged) {
    return {
      ok: false,
      error: "开发模式（npm start）不检查更新，请安装打包后的 .app 再试",
    };
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result) {
      return { ok: false, error: "检查更新未返回结果" };
    }
    return {
      ok: true,
      message: `已检查，当前 ${app.getVersion()}，远端 ${result.updateInfo.version}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function downloadAppUpdate(): Promise<
  { ok: true; message: string } | { ok: false; error: string }
> {
  if (!app.isPackaged) {
    return { ok: false, error: "开发模式不能下载更新" };
  }
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true, message: "已开始下载更新" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function getUpdateMeta(): { version: string; packaged: boolean } {
  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
  };
}
