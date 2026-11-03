import fs from "node:fs";
import path from "node:path";

import { app, dialog, type BrowserWindow } from "electron";
import type { UpdateInfo } from "electron-updater";
import { autoUpdater } from "./updater";

import { hasInflightCrawlTasks } from "../crawl/bridgeServer";

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
  busy?: boolean;
};

type GetWindow = () => BrowserWindow | null;

let configured = false;
let updating = false;
let updateReady = false;
let updateWindow: GetWindow = () => null;
let lastStatus: UpdateStatusEvent = { kind: "not-available", message: "尚未检查" };

// Prevent concurrent downloads or replacing an installer that is already ready.
async function runUpdate<T>(operation: () => Promise<T>): Promise<T> {
  if (updating || updateReady) throw new Error("更新正在进行或等待安装，暂时不能执行此操作");
  updating = true;
  send(updateWindow, lastStatus);
  try {
    return await operation();
  } finally {
    updating = false;
    send(updateWindow, lastStatus);
  }
}

/** 凌晨安装窗口（本地时间），窗口内且没有抓取任务才重启 */
const NIGHT_START_HOUR = 2;
const NIGHT_END_HOUR = 5;
/** 临时：下载完成后马上安装，方便看重启后窗口是否抢前台。测完改回 false */
const INSTALL_NOW_FOR_TEST = true;
const UPDATE_CHECK_INTERVAL_MS = INSTALL_NOW_FOR_TEST ? 15_000 : 60 * 60 * 1000;
const UPDATE_CHECK_DELAY_MS = INSTALL_NOW_FOR_TEST ? 5_000 : 15_000;
const INSTALL_NOW_DELAY_MS = 5_000;
const BUSY_RETRY_MS = 60_000;
/** 凌晨安装后的下一次启动：Windows 窗口隐藏到托盘 */
const LAUNCH_WITHOUT_FOCUS_FLAG = "launch-without-focus";

function launchWithoutFocusFlagPath(): string {
  return path.join(app.getPath("userData"), LAUNCH_WITHOUT_FOCUS_FLAG);
}

function markLaunchWithoutFocus(): void {
  fs.writeFileSync(launchWithoutFocusFlagPath(), "");
}

/** 本次启动是否由凌晨更新拉起；读到后即删掉，只生效一次 */
export function consumeLaunchWithoutFocus(): boolean {
  try {
    fs.unlinkSync(launchWithoutFocusFlagPath());
    return true;
  } catch {
    return false;
  }
}

let nightInstallTimer: ReturnType<typeof setTimeout> | null = null;
let nightInstallStarted = false;

function isInNightWindow(now = new Date()): boolean {
  if (INSTALL_NOW_FOR_TEST) return true;
  const hour = now.getHours();
  return hour >= NIGHT_START_HOUR && hour < NIGHT_END_HOUR;
}

function msUntilNightWindow(now = new Date()): number {
  if (INSTALL_NOW_FOR_TEST) return INSTALL_NOW_DELAY_MS;
  if (isInNightWindow(now)) return 0;
  const start = new Date(now);
  start.setHours(NIGHT_START_HOUR, 0, 0, 0);
  if (now.getTime() >= start.getTime()) start.setDate(start.getDate() + 1);
  return start.getTime() - now.getTime();
}

function scheduleWindowsNightInstall(getWindow: GetWindow): void {
  if (nightInstallStarted) return;
  if (nightInstallTimer) clearTimeout(nightInstallTimer);
  const wait = msUntilNightWindow();
  nightInstallTimer = setTimeout(() => {
    nightInstallTimer = null;
    tryWindowsNightInstall(getWindow);
  }, wait);
}

function tryWindowsNightInstall(getWindow: GetWindow): void {
  if (nightInstallStarted) return;
  if (!isInNightWindow()) {
    scheduleWindowsNightInstall(getWindow);
    return;
  }
  if (hasInflightCrawlTasks()) {
    send(getWindow, {
      kind: "downloaded",
      message: "更新已下载，当前有抓取任务，空闲后再重启安装",
    });
    nightInstallTimer = setTimeout(() => tryWindowsNightInstall(getWindow), BUSY_RETRY_MS);
    return;
  }
  nightInstallStarted = true;
  send(getWindow, { kind: "downloaded", message: "正在重启并安装更新…" });
  markLaunchWithoutFocus();
  // 静默安装并重新打开；新窗口隐藏到托盘
  autoUpdater.quitAndInstall(true, true);
}

function send(getWindow: GetWindow, event: UpdateStatusEvent): void {
  lastStatus = event;
  getWindow()?.webContents.send("update:event:status", { ...event, busy: updating || updateReady });
}

export function setupAutoUpdater(getWindow: GetWindow): void {
  if (configured) return;
  configured = true;
  updateWindow = getWindow;

  // 公开 GitHub Release，客户端无需 Token
  // Windows 安装包自动下载，凌晨空闲时重启安装；提前退出也会装上
  const autoUpdate = process.platform === "win32" && app.isPackaged;
  autoUpdater.autoDownload = autoUpdate;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    send(getWindow, { kind: "checking", message: "正在检查更新…" });
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    send(getWindow, {
      kind: "available",
      message: `发现版本 ${info.version}`,
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
    updateReady = true;
    if (process.platform === "win32") {
      send(getWindow, {
        kind: "downloaded",
        message: INSTALL_NOW_FOR_TEST
          ? `更新 ${info.version} 已下载，约 ${INSTALL_NOW_DELAY_MS / 1000} 秒后重启安装（测试）`
          : `更新 ${info.version} 已下载，将在凌晨 ${NIGHT_START_HOUR}:00–${NIGHT_END_HOUR}:00 没有抓取任务时重启安装`,
        version: info.version,
      });
      scheduleWindowsNightInstall(getWindow);
      return;
    }

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

  if (autoUpdate) {
    const check = () => {
      if (updating || updateReady) return;
      void checkForAppUpdates();
    };
    setTimeout(check, UPDATE_CHECK_DELAY_MS);
    setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  }
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
    const result = await runUpdate(async () => {
      const result = await autoUpdater.checkForUpdates();
      if (result?.downloadPromise) await result.downloadPromise;
      return result;
    });
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
    await runUpdate(() => autoUpdater.downloadUpdate());
    return { ok: true, message: "已开始下载更新" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function getUpdateMeta(): { version: string; packaged: boolean; busy: boolean } {
  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
    busy: updating || updateReady,
  };
}
