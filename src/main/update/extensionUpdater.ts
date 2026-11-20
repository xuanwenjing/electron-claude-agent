import { app, net } from "electron";
import AdmZip from "adm-zip";
import fs from "node:fs";
import path from "node:path";

import { authSession } from "../auth";
import { isExtensionConnected, reloadExtension } from "../crawl/bridgeServer";
import { request } from "../utils/request";

type RemoteExtensionInfo = { version: string; url: string };

export type ExtensionUpdateResult =
  | { ok: true; updated: false; version: string | null; message: string }
  | { ok: true; updated: true; version: string; previousVersion: string | null; reloadSent: boolean }
  | { ok: false; error: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 安装包内附带的初始版本（只读） */
function getBundledExtensionDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "chrome-extension");
  }
  return path.join(__dirname, "../../../chrome-extension/dist");
}

/** 用户在 chrome://extensions「加载已解压的扩展程序」时选的固定目录 */
export function getInstalledExtensionDir(): string {
  return path.join(app.getPath("userData"), "chrome-extension");
}

function siblingDir(suffix: string): string {
  return `${getInstalledExtensionDir()}.${suffix}`;
}

function readManifestVersion(dir: string): string | null {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function rmDir(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true });
}

/** Windows 上杀毒软件 / 索引服务短暂占用文件时 rename 会 EPERM/EBUSY，重试几次 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      await sleep(200 * (attempt + 1));
    }
  }
}

/** 上次替换中途退出时：正式目录缺失则用 .old 回滚，并清理残留的 .new / .old */
async function recoverInterruptedSwap(): Promise<void> {
  const target = getInstalledExtensionDir();
  const oldDir = siblingDir("old");
  if (!fs.existsSync(target) && fs.existsSync(oldDir)) {
    await renameWithRetry(oldDir, target);
  }
  await rmDir(siblingDir("new"));
  await rmDir(siblingDir("download"));
  await rmDir(oldDir);
}

/** .new → 正式目录：正式目录先改名 .old，替换成功后删 .old，失败则回滚 */
async function swapInNewDir(): Promise<void> {
  const target = getInstalledExtensionDir();
  const newDir = siblingDir("new");
  const oldDir = siblingDir("old");

  const hadTarget = fs.existsSync(target);
  if (hadTarget) await renameWithRetry(target, oldDir);
  try {
    await renameWithRetry(newDir, target);
  } catch (err) {
    if (hadTarget) await renameWithRetry(oldDir, target);
    throw err;
  }
  await rmDir(oldDir);
}

/**
 * 启动时调用：固定目录不存在，或安装包内版本更高时，用安装包内版本覆盖。
 * 开发态版本号不变，每次启动都用 chrome-extension/dist 覆盖。
 * 已安装的版本被更高的内置版本换掉时，通知正在运行的扩展重载。
 */
export async function ensureExtensionInstalled(): Promise<string> {
  const target = getInstalledExtensionDir();
  await recoverInterruptedSwap();

  const bundled = getBundledExtensionDir();
  const bundledVersion = readManifestVersion(bundled);
  if (!bundledVersion) {
    console.warn("[ext-install] 未找到内置扩展（开发态请先 npm run ext:build）:", bundled);
    return target;
  }

  const installedVersion = readManifestVersion(target);
  const bundledIsNewer = !!installedVersion && compareVersions(bundledVersion, installedVersion) > 0;
  if (app.isPackaged && installedVersion && !bundledIsNewer) {
    return target;
  }

  await fs.promises.cp(bundled, siblingDir("new"), { recursive: true });
  await swapInNewDir();
  console.log(`[ext-install] 已安装内置扩展 ${installedVersion ?? "(无)"} → ${bundledVersion}:`, target);
  if (bundledIsNewer) {
    const reloadSent = requestReload();
    console.log(
      `[ext-install] ${reloadSent ? "已发送 reload_extension" : "扩展未连接，连上后再发送 reload_extension"}`,
    );
  }
  return target;
}

/** zip 可能直接是扩展文件，也可能多包了一层目录 */
function findManifestRoot(dir: string): string | null {
  if (fs.existsSync(path.join(dir, "manifest.json"))) return dir;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith("__MACOSX"));
  if (entries.length === 1 && entries[0].isDirectory()) {
    const nested = path.join(dir, entries[0].name);
    if (fs.existsSync(path.join(nested, "manifest.json"))) return nested;
  }
  return null;
}

/** GET /admin/chrome-extension；首次发布前 data 为 null，返回 null 表示无需更新 */
async function fetchRemoteInfo(): Promise<RemoteExtensionInfo | null> {
  const body = await request.request({ url: "/admin/chrome-extension", method: "GET" });
  if (!body || body.code !== 200) {
    throw new Error(body?.msg || body?.message || "查询最新插件版本失败");
  }
  if (body.data == null) return null;
  const { version, download_url } = body.data as { version?: unknown; download_url?: unknown };
  if (typeof version !== "string" || !version || typeof download_url !== "string" || !/^https?:\/\//i.test(download_url)) {
    throw new Error("最新插件版本格式错误，需要 { version, download_url }");
  }
  return { version, url: download_url };
}

async function downloadAndExtract(zipUrl: string): Promise<void> {
  const res = await net.fetch(zipUrl);
  if (!res.ok) throw new Error(`下载扩展包失败: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const downloadDir = siblingDir("download");
  const newDir = siblingDir("new");
  await rmDir(downloadDir);
  await rmDir(newDir);
  try {
    new AdmZip(buffer).extractAllTo(downloadDir, true);
    const root = findManifestRoot(downloadDir);
    if (!root) throw new Error("扩展包内未找到 manifest.json");
    await renameWithRetry(root, newDir);
  } finally {
    await rmDir(downloadDir);
  }
}

let pendingReload = false;
let updating: Promise<ExtensionUpdateResult> | null = null;

function requestReload(): boolean {
  if (isExtensionConnected() && reloadExtension().ok) {
    pendingReload = false;
    return true;
  }
  pendingReload = true;
  return false;
}

/** 扩展连上 bridge 时调用：更新时扩展未连接，则补发 reload_extension */
export function flushPendingExtensionReload(): void {
  if (pendingReload) requestReload();
}

async function runRemoteUpdate(): Promise<ExtensionUpdateResult> {
  const installedVersion = readManifestVersion(getInstalledExtensionDir());
  if (!authSession.getRequestContext().token) {
    return { ok: true, updated: false, version: installedVersion, message: "未登录，登录后再检查扩展更新" };
  }

  try {
    const remote = await fetchRemoteInfo();
    if (!remote) {
      return { ok: true, updated: false, version: installedVersion, message: "后台尚未发布插件" };
    }
    if (remote.version === installedVersion) {
      return { ok: true, updated: false, version: installedVersion, message: `扩展已是最新版本 ${remote.version}` };
    }

    await downloadAndExtract(remote.url);
    try {
      await swapInNewDir();
    } finally {
      await rmDir(siblingDir("new"));
    }
    const reloadSent = requestReload();
    return { ok: true, updated: true, version: remote.version, previousVersion: installedVersion, reloadSent };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 查询后台发布的最新插件，版本不一致则下载替换并通知扩展重载 */
export function checkRemoteExtensionUpdate(): Promise<ExtensionUpdateResult> {
  if (!updating) {
    updating = runRemoteUpdate().finally(() => {
      updating = null;
    });
  }
  return updating;
}
