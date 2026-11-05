const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const ts = require("typescript");
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "..", file), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  ).outputText;
  vm.runInNewContext(source, {
    exports,
    URL,
    console,
    process,
    require: (name) => mocks[name] || require(name),
    ...globals,
  });
  return exports;
}
test("request logs retain original credentials, JSON bodies, URL parameters, status and timing", () => {
  const { RequestLogStore } = load("src/main/diagnostics/requestLogs.ts");
  const store = new RequestLogStore();
  const id = store.begin({
    method: "post",
    baseURL: "http://localhost:3000",
    url: "/api/login?token=secret-url&mobile=13800000001",
    data: JSON.stringify({ sms_code: "123456", password: "secret-password" }),
    headers: {
      Authorization: "Bearer secret-token",
      Cookie: "session=secret-cookie",
      outlet_code: "a",
    },
  });
  store.finish(id, {
    status: 200,
    body: {
      code: 200,
      data: {
        access_token: "secret-access",
        refresh_token: "secret-refresh",
        mobile: "13800000001",
      },
    },
    durationMs: 25,
    failed: false,
  });
  const log = store.list()[0];
  for (const value of [
    "secret-url",
    "13800000001",
    "123456",
    "secret-password",
    "secret-token",
    "secret-cookie",
    "secret-access",
    "secret-refresh",
  ])
    assert.ok(JSON.stringify(log).includes(value), value);
  assert.equal(log.status, 200);
  assert.equal(log.durationMs, 25);
  assert.equal(log.state, "success");
  assert.ok(log.request.includes("outlet_code"));
});
test("logs are bounded, safe for circular/large data, and clearing never resurrects pending calls", () => {
  const { RequestLogStore } = load("src/main/diagnostics/requestLogs.ts");
  const store = new RequestLogStore();
  const circular = {};
  circular.self = circular;
  for (let i = 0; i < 55; i++) store.begin({ url: "/test", data: circular });
  assert.equal(store.list().length, 50);
  const id = store.begin({ url: "/long", data: { value: "a".repeat(20000) } });
  assert.equal(
    JSON.parse(store.list().at(-1).request).body.value,
    "a".repeat(20000),
  );
  assert.equal(store.list()[0].id, 7);
  store.clear();
  store.finish(id, { body: {}, durationMs: 0, failed: false });
  assert.equal(store.list().length, 0);
});
test("log IPC reads and clears without a password or environment configuration", () => {
  const handlers = {};
  let clears = 0;
  const { registerRequestLogsIpc } = load(
    "src/main/ipc/requestLogs.ts",
    {
      electron: { ipcMain: { handle: (name, fn) => (handlers[name] = fn) } },
      "../diagnostics/requestLogs": {
        requestLogs: { list: () => [{ id: 1 }], clear: () => clears++ },
      },
    },
    { process: { env: {} } },
  );
  registerRequestLogsIpc();
  assert.deepEqual(Object.keys(handlers).sort(), [
    "requestLogs:clear",
    "requestLogs:read",
  ]);
  assert.equal(handlers["requestLogs:read"]().data[0].id, 1);
  assert.equal(handlers["requestLogs:clear"]().ok, true);
  assert.equal(clears, 1);
});

test("long URLs, arrays, object fields, nested data and repeated references remain complete", () => {
  const { RequestLogStore, formatLogValue } = load(
    "src/main/diagnostics/requestLogs.ts",
  );
  const shared = { value: "same" };
  let nested = { last: "end" };
  for (let i = 0; i < 12; i++) nested = { child: nested };
  const body = {
    text: "z".repeat(30000),
    rows: Array.from({ length: 150 }, (_, i) => i),
    fields: Object.fromEntries(Array.from({ length: 150 }, (_, i) => [i, i])),
    nested,
    a: shared,
    b: shared,
  };
  assert.deepEqual(JSON.parse(formatLogValue(body)), body);
  const store = new RequestLogStore();
  const url = "http://localhost/test?q=" + "a".repeat(5000);
  const id = store.begin({ url, data: body });
  store.finish(id, { status: 200, body, durationMs: 1, failed: false });
  assert.equal(store.list()[0].url, url);
  assert.deepEqual(JSON.parse(store.list()[0].response), body);
  assert.deepEqual(JSON.parse(store.list()[0].request).body, body);
  const circular = {};
  circular.self = circular;
  assert.equal(JSON.parse(formatLogValue(circular)).self, "[循环引用]");
});
