import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function windowsChromePath(): string {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
    process.env["PROGRAMFILES(X86)"] &&
      path.join(process.env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe"),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => fs.existsSync(p)) ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
}

export function openUrlInChrome(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const isMac = process.platform === "darwin";
    const isWin = process.platform === "win32";
    const cmd = isMac ? "open" : isWin ? windowsChromePath() : "google-chrome";
    const args = isMac ? ["-a", "Google Chrome", url] : [url];
    const child = spawn(cmd, args, {
      detached: !isMac,
      stdio: "ignore",
    });

    child.once("error", (err) => {
      reject(new Error(`无法启动 Chrome: ${err.message}`));
    });

    if (isMac) {
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error("未找到 Google Chrome，请确认已安装"));
      });
      return;
    }

    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
