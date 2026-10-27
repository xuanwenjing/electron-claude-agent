#!/usr/bin/env node
/**
 * 确保 electron 二进制完整（部分环境下 postinstall 被跳过或 extract-zip 解压不全）。
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const electronDir = path.join(__dirname, "../node_modules/electron");
const distDir = path.join(electronDir, "dist");
const platformPath =
  process.platform === "darwin"
    ? "Electron.app/Contents/MacOS/Electron"
    : process.platform === "win32"
      ? "electron.exe"
      : "electron";
const binaryPath = path.join(distDir, platformPath);

if (fs.existsSync(binaryPath)) {
  process.exit(0);
}

console.log("[ensure-electron] Electron 二进制缺失，正在安装…");
const result = spawnSync(process.execPath, [path.join(electronDir, "install.js")], {
  stdio: "inherit",
  env: process.env,
});

if (result.status !== 0 || !fs.existsSync(binaryPath)) {
  // 常见兜底：缓存 zip 有效但 extract-zip 解压不全时，用系统 unzip
  const cacheRoot = path.join(process.env.HOME || "", "Library/Caches/electron");
  if (process.platform === "darwin" && fs.existsSync(cacheRoot)) {
    const zips = [];
    for (const dir of fs.readdirSync(cacheRoot)) {
      const zip = path.join(cacheRoot, dir, `electron-v${require("../node_modules/electron/package.json").version}-darwin-${process.arch}.zip`);
      if (fs.existsSync(zip)) zips.push(zip);
    }
    if (zips.length) {
      const zip = zips[zips.length - 1];
      console.log("[ensure-electron] 尝试用 unzip 从缓存解压:", zip);
      fs.rmSync(distDir, { recursive: true, force: true });
      fs.mkdirSync(distDir, { recursive: true });
      const unzip = spawnSync("unzip", ["-q", zip, "-d", distDir], { stdio: "inherit" });
      if (unzip.status === 0 && fs.existsSync(binaryPath)) {
        fs.writeFileSync(path.join(electronDir, "path.txt"), platformPath);
        console.log("[ensure-electron] 解压成功");
        process.exit(0);
      }
    }
  }

  console.error("[ensure-electron] Electron 安装失败。可手动执行:");
  console.error("  rm -rf node_modules/electron && npm i electron --force");
  console.error("  或设置 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/");
  process.exit(1);
}
