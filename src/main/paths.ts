import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

/** 内置 skill 插件目录（必须是真实磁盘路径，不能在 asar 内） */
export function getSkillsPluginDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "skills-plugin");
  }
  return path.join(__dirname, "../../resources/skills-plugin");
}

/**
 * 内置 Python（python-build-standalone）根目录。
 * 开发态按 electron-builder 的 ${os}-${arch} 取 resources/python 下对应目录，
 * 打包态由 extraResources 拷到 resources/python。
 */
export function getPythonHome(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "python");
  }
  const os = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : process.platform;
  return path.join(__dirname, "../../resources/python", `${os}-${process.arch}`);
}

/** 解释器所在目录，用于放到 PATH 最前面 */
export function getPythonBinDir(): string {
  const home = getPythonHome();
  return process.platform === "win32" ? home : path.join(home, "bin");
}

/** 内置解释器路径；未准备（开发态没跑 python:fetch）时返回 null */
export function getPythonExecutable(): string | null {
  const exe = path.join(getPythonBinDir(), process.platform === "win32" ? "python.exe" : "python3");
  return fs.existsSync(exe) ? exe : null;
}

/**
 * Agent 工作区：Read / Glob / Grep / Bash 默认在这里执行。
 * 开发态用仓库下的 workspace/；打包态复制到 userData，避免改安装包内文件。
 */
export function ensureWorkspaceDir(): string {
  if (app.isPackaged) {
    const dir = path.join(app.getPath("userData"), "workspace");
    fs.mkdirSync(dir, { recursive: true });
    seedWorkspaceIfEmpty(dir, path.join(process.resourcesPath, "workspace"));
    return dir;
  }
  const dir = path.join(__dirname, "../../workspace");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function seedWorkspaceIfEmpty(target: string, seedFrom: string): void {
  const entries = fs.readdirSync(target);
  if (entries.length > 0 || !fs.existsSync(seedFrom)) return;
  for (const name of fs.readdirSync(seedFrom)) {
    const from = path.join(seedFrom, name);
    const to = path.join(target, name);
    fs.cpSync(from, to, { recursive: true });
  }
}
