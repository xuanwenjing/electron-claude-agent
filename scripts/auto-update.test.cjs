const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = process.env.UPDATE_REPO || path.resolve(__dirname, "..");
const ts = require(path.join(root, "node_modules/typescript"));
function fixture({ platform = "win32", packaged = true } = {}) {
  const timers = [],
    intervals = [],
    installs = [],
    events = [];
  let now = new Date(2026, 10, 3, 12),
    busy = false,
    checks = 0;
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {
    checks++;
    return {
      updateInfo: { version: "1.0.1" },
      downloadPromise: updater.autoDownload ? updater.downloadUpdate() : null,
    };
  };
  updater.downloadUpdate = async () => {
    updater.emit("update-downloaded", { version: "1.0.1" });
    return ["setup.exe"];
  };
  updater.quitAndInstall = (...args) => installs.push(args);
  const exports = {};
  const file =
    process.env.UPDATE_SOURCE ||
    path.join(root, "src/main/update/appUpdater.ts");
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    process: { platform },
    Date: class extends Date {
      constructor(...args) {
        super(...(args.length ? args : [now.getTime()]));
      }
    },
    setTimeout: (fn, delay) => {
      timers.push({ fn, delay });
      return timers.length;
    },
    clearTimeout() {},
    setInterval: (fn, delay) => intervals.push({ fn, delay }),
    require(name) {
      if (name === "electron")
        return {
          app: {
            isPackaged: packaged,
            getVersion: () => "1.0.0",
            getPath: () => "/tmp",
          },
        };
      if (name === "./updater") return { autoUpdater: updater };
      if (name === "../crawl/bridgeServer")
        return { hasActiveCrawlTasks: () => busy };
      if (name === "node:fs") return { writeFileSync() {} };
      return require(name);
    },
  });
  exports.setupAutoUpdater(() => ({
    webContents: { send: (_channel, event) => events.push(event) },
  }));
  return {
    api: exports,
    updater,
    timers,
    intervals,
    installs,
    events,
    checks: () => checks,
    setBusy: (v) => (busy = v),
    setHour: (h) => (now = new Date(2026, 10, 4, h)),
  };
}
test("packaged Windows starts checks and automatic download, then waits for the night window", async () => {
  const f = fixture();
  assert.equal(f.updater.autoDownload, true);
  assert.equal(f.updater.autoInstallOnAppQuit, true);
  assert.equal(f.timers[0].delay, 15000);
  assert.equal(f.intervals[0].delay, 4 * 60 * 60 * 1000);
  f.timers.shift().fn();
  await new Promise(setImmediate);
  assert.equal(f.checks(), 1);
  assert.equal(f.api.getUpdateMeta().busy, true);
  assert.equal(f.timers[0].delay, 14 * 60 * 60 * 1000);
  f.intervals[0].fn();
  assert.equal(f.checks(), 1);
  assert.deepEqual(f.installs, []);
  f.setHour(2);
  f.setBusy(true);
  f.timers.shift().fn();
  assert.deepEqual(f.installs, []);
  assert.equal(f.timers[0].delay, 60000);
  f.setBusy(false);
  f.timers.shift().fn();
  assert.deepEqual(f.installs, [[true, true]]);
});
test("development and non-Windows do not start background checks", () => {
  for (const options of [{ packaged: false }, { platform: "darwin" }]) {
    const f = fixture(options);
    assert.equal(f.updater.autoDownload, false);
    assert.equal(f.timers.length, 0);
    assert.equal(f.intervals.length, 0);
  }
});
