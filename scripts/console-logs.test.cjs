const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file) {
  const exportsObject = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path.join(__dirname, file), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports: exportsObject,
      require,
      console,
    },
  );
  return exportsObject;
}

const logs = load("../src/main/diagnostics/consoleLogs.ts");

test("console capture keeps the original output and the latest lines", () => {
  logs.clearConsoleLogs();
  const seen = [];
  const target = {
    log: (...args) => seen.push(["log", args]),
    info: () => {},
    warn: () => {},
    error: (...args) => seen.push(["error", args]),
    debug: () => {},
  };
  logs.installConsoleCapture(target);
  target.log("[tasks]", "已载入", 1, "个任务");
  target.error({ code: "bad" });
  assert.deepEqual(seen[0], ["log", ["[tasks]", "已载入", 1, "个任务"]]);
  const entries = logs.listConsoleLogs();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].level, "log");
  assert.match(entries[0].message, /\[tasks\] 已载入 1 个任务/);
  assert.equal(entries[1].level, "error");
  assert.match(entries[1].message, /bad/);
  logs.clearConsoleLogs();
  assert.equal(logs.listConsoleLogs().length, 0);
});
