import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { isExtensionConnected, minimizeBrowser, waitForExtensionConnected } from "./bridgeServer";

const EDGE_APP_MAC = "Microsoft Edge";
const EDGE_APP_MAC_PATHS = ["/Applications/Microsoft Edge.app", path.join(process.env.HOME ?? "", "Applications/Microsoft Edge.app")];
/** 扩展 SW 休眠后靠 1 分钟周期 alarm 重连，等待需覆盖一个周期 */
const CONNECT_TIMEOUT_MS = 70_000;

export type EnsureConnectedResult = { ok: true } | { ok: false; error: string };

function windowsEdgePath(): string | null {
  const candidates = [
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Microsoft/Edge/Application/msedge.exe"),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft/Edge/Application/msedge.exe"),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function execResult(cmd: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) =>
      resolve({ ok: !err, output: `${stdout}${stderr}`.trim() || (err?.message ?? "") }),
    );
  });
}

function spawnDetached(cmd: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", (err) => resolve({ ok: false, output: err.message }));
    child.once("spawn", () => {
      child.unref();
      resolve({ ok: true, output: "" });
    });
  });
}

/** 按当前系统启动（或唤起已运行的）Edge，返回失败原因 */
async function launchEdge(log: (msg: string) => void): Promise<string | null> {
  if (process.platform === "darwin") {
    if (!EDGE_APP_MAC_PATHS.some((p) => fs.existsSync(p))) return "未找到 Microsoft Edge（/Applications/Microsoft Edge.app）";
    log("macOS：open -g -a \"Microsoft Edge\"");
    const res = await execResult("open", ["-g", "-a", EDGE_APP_MAC]);
    return res.ok ? null : `启动 Edge 失败：${res.output}`;
  }
  if (process.platform === "win32") {
    const exe = windowsEdgePath();
    if (!exe) return "未找到 msedge.exe（Program Files / LocalAppData 下的 Microsoft\\Edge\\Application）";
    log(`Windows：${exe}`);
    const res = await spawnDetached(exe, []);
    return res.ok ? null : `启动 Edge 失败：${res.output}`;
  }
  return `暂不支持在 ${process.platform} 上自动启动 Edge`;
}

let pending: Promise<EnsureConnectedResult> | null = null;

/**
 * 扩展未连接时：启动 Edge，等扩展连上 bridge 后通知其最小化浏览器窗口。
 * log 记录每一步，供写入 result.json。
 */
export function ensureExtensionConnected(log: (msg: string) => void = () => {}): Promise<EnsureConnectedResult> {
  if (isExtensionConnected()) return Promise.resolve({ ok: true });
  pending ??= (async (): Promise<EnsureConnectedResult> => {
    try {
      log("扩展未连接，正在启动 Edge…");
      const launchError = await launchEdge(log);
      if (launchError) return { ok: false, error: launchError };
      log(`已启动 Edge，等待扩展连接（最长 ${CONNECT_TIMEOUT_MS / 1000}s）…`);
      if (!(await waitForExtensionConnected(CONNECT_TIMEOUT_MS))) {
        return {
          ok: false,
          error: `Edge 已启动，但扩展 ${CONNECT_TIMEOUT_MS / 1000}s 内未连接，请确认 Edge 已加载并启用本扩展`,
        };
      }
      log("扩展已连接，通知扩展最小化浏览器");
      minimizeBrowser();
      return { ok: true };
    } finally {
      pending = null;
    }
  })();
  return pending;
}
