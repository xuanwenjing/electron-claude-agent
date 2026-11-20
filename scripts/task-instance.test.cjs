const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, mocks) {
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
      require: (name) => mocks[name] ?? require(name),
      console,
      FormData,
      Blob,
      Uint8Array,
    },
  );
  return exportsObject;
}

test("a run asks for an instance, uploads the json, then reports the url", async () => {
  const calls = [];
  const report = load("../src/main/tasks/report.ts", {
    "../push/deviceId": { getDeviceNumber: () => "device-1" },
    "../utils/request": {
      request: {
        request: async (config) => {
          calls.push(config);
          if (config.url === "/client/task/instance") {
            return { code: 200, data: { instance_code: "inst_001", status: "RUNNING" } };
          }
          if (config.url === "/file/uploadFile") return { code: 200, data: { url: "https://cdn.example/report.json" } };
          if (config.url === "/data/event/report") return { code: 200, data: true };
          return { code: 500, message: "未知接口" };
        },
      },
    },
  });

  assert.equal(await report.createTaskInstance("task_review_001", "2026-11-19T01:00:00Z"), "inst_001");
  assert.equal(calls[0].data.client_task_code, "task_review_001");
  assert.equal(calls[0].data.scheduled_at, "2026-11-19T01:00:00Z");
  assert.equal(calls[0].headers["Device-Number"], "device-1");

  const payload = {
    taskId: "inst_001",
    clientTaskCode: "task_review_001",
    businessType: "REVIEW_REPLY",
    ok: true,
    data: { replies: [] },
  };
  const url = await report.publishTaskResult(payload);
  assert.equal(url, "https://cdn.example/report.json");

  const upload = calls[1];
  assert.equal(upload.url, "/file/uploadFile");
  assert.equal(upload.data instanceof FormData, true);
  const uploaded = JSON.parse(await upload.data.get("file").text());
  assert.equal(uploaded.taskId, "inst_001");
  assert.equal(uploaded.clientTaskCode, "task_review_001");
  assert.equal(uploaded.instanceCode, undefined);
  assert.equal(uploaded.businessType, "REVIEW_REPLY");
  assert.equal(uploaded.instance_code, undefined);
  assert.equal(uploaded.data.businessType, undefined);
  assert.deepEqual(uploaded.data, { replies: [] });
  const reportCall = calls[2];
  assert.equal(reportCall.url, "/data/event/report");
  assert.equal(reportCall.data.event, "data.report");
  assert.equal(reportCall.data.data, "https://cdn.example/report.json");
  assert.match(reportCall.data.event_id, /^[0-9a-f-]{36}$/);
  assert.equal(reportCall.headers["Device-Number"], "device-1");
});

test("instance and report failures surface the server message", async () => {
  const report = load("../src/main/tasks/report.ts", {
    "../push/deviceId": { getDeviceNumber: () => "device-1" },
    "../utils/request": {
      request: {
        request: async (config) =>
          config.url === "/data/event/report"
            ? { code: 500, message: "上报失败" }
            : { code: 409, message: "任务不可执行" },
      },
    },
  });
  await assert.rejects(() => report.createTaskInstance("task_review_001", "2026-11-19T01:00:00Z"), /任务不可执行/);
  await assert.rejects(() => report.reportResultUrl("https://cdn.example/report.json", "event-1"), /上报失败/);
});
