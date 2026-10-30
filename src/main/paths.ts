import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

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
 * 客户端数据目录：抓取结果 crawl/、run_agent 工作空间 agent-runs/。
 * 开发态用仓库下的 workspace/；打包态用 userData/workspace。
 */
export function ensureWorkspaceDir(): string {
  const dir = app.isPackaged
    ? path.join(app.getPath("userData"), "workspace")
    : path.join(__dirname, "../../workspace");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
