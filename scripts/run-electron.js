#!/usr/bin/env node
/**
 * 启动 Electron，并强制关闭 ELECTRON_RUN_AS_NODE。
 * Cursor / 某些 IDE 会注入该变量，导致 require('electron') 变成路径字符串而不是 API。
 */
const { spawn } = require("node:child_process");
const electron = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, process.argv.slice(2), {
  stdio: "inherit",
  env,
  windowsHide: false,
});

child.on("close", (code, signal) => {
  if (code === null) {
    console.error(electron, "exited with signal", signal);
    process.exit(1);
  }
  process.exit(code);
});
