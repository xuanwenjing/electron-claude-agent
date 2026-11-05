import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { isExtensionConnected, minimizeBrowser, waitForExtensionConnected } from "./bridgeServer";
import { unblockSiteInEdge } from "./edgeSitePermissions";

const EDGE_APP_MAC = "Microsoft Edge";
const EDGE_EXE_WIN = "msedge.exe";
const QUIT_TIMEOUT_MS = 15_000;
const QUIT_POLL_MS = 500;
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

/**
 * 在 Edge 里新开一个窗口打开页面。
 * 不复用已有窗口，避免落到带蒙层的采集窗口里。返回失败原因。
 */
export async function openInEdge(url: string): Promise<string | null> {
  if (process.platform === "darwin") {
    if (!EDGE_APP_MAC_PATHS.some((p) => fs.existsSync(p)))
      return "未找到 Microsoft Edge（/Applications/Microsoft Edge.app）";
    const res = await execResult("open", [
      "-n",
      "-a",
      EDGE_APP_MAC,
      "--args",
      "--new-window",
      url,
    ]);
    return res.ok ? null : `打开 Edge 失败：${res.output}`;
  }
  if (process.platform === "win32") {
    const exe = windowsEdgePath();
    if (!exe)
      return "未找到 msedge.exe（Program Files / LocalAppData 下的 Microsoft\\Edge\\Application）";
    const res = await spawnDetached(exe, ["--new-window", url]);
    return res.ok ? null : `打开 Edge 失败：${res.output}`;
  }
  return `暂不支持在 ${process.platform} 上打开 Edge`;
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

async function isEdgeRunning(): Promise<boolean> {
  if (process.platform === "darwin") {
    const res = await execResult("osascript", ["-e", `application "${EDGE_APP_MAC}" is running`]);
    return res.output === "true";
  }
  if (process.platform === "win32") {
    const res = await execResult("tasklist", ["/FI", `IMAGENAME eq ${EDGE_EXE_WIN}`, "/NH"]);
    return res.output.toLowerCase().includes(EDGE_EXE_WIN);
  }
  return false;
}

async function waitEdgeExit(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (await isEdgeRunning()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, QUIT_POLL_MS));
  }
  return true;
}

/** 正常退出 Edge（退出时 Edge 会把内存中的配置写回 Preferences），返回失败原因 */
async function quitEdge(log: (msg: string) => void): Promise<string | null> {
  if (process.platform === "darwin") {
    log(`macOS：quit app "${EDGE_APP_MAC}"`);
    await execResult("osascript", ["-e", `quit app "${EDGE_APP_MAC}"`]);
  } else if (process.platform === "win32") {
    log(`Windows：taskkill /IM ${EDGE_EXE_WIN}`);
    await execResult("taskkill", ["/IM", EDGE_EXE_WIN]);
  } else {
    return `暂不支持在 ${process.platform} 上退出 Edge`;
  }
  if (await waitEdgeExit(QUIT_TIMEOUT_MS)) return null;
  if (process.platform === "win32") {
    // 开了「启动增强 / 后台运行」时 msedge 不响应正常关闭
    log(`Edge 未退出，taskkill /F /IM ${EDGE_EXE_WIN}`);
    await execResult("taskkill", ["/F", "/IM", EDGE_EXE_WIN]);
    if (await waitEdgeExit(QUIT_TIMEOUT_MS)) return null;
  }
  return `Edge ${QUIT_TIMEOUT_MS / 1000}s 内未退出`;
}

/**
 * 站点被设为「不允许使用扩展」：Edge 运行中改配置无效（退出时会被内存中的值覆盖），
 * 所以先退出 Edge，再改 Preferences，最后重新拉起并等扩展连上。
 */
export async function restartEdgeWithSiteUnblocked(
  origin: string,
  log: (msg: string) => void,
): Promise<EnsureConnectedResult> {
  log(`站点 ${origin} 被设为「不允许使用扩展」，退出 Edge 后解除`);
  const quitError = await quitEdge(log);
  if (quitError) return { ok: false, error: quitError };
  let unblockError: string | null = null;
  try {
    const profiles = await unblockSiteInEdge(origin);
    log(`已从 Edge 配置（${profiles.join("、")}）移除 ${origin} 的「不允许使用扩展」`);
  } catch (err) {
    unblockError = err instanceof Error ? err.message : String(err);
  }
  const connected = await ensureExtensionConnected(log);
  if (unblockError) return { ok: false, error: unblockError };
  return connected;
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
