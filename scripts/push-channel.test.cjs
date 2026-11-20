const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const loaded = new Map();

function load(file) {
  const abs = path.resolve(__dirname, file);
  const cached = loaded.get(abs);
  if (cached) return cached;
  const exportsObject = {};
  loaded.set(abs, exportsObject);
  const dir = path.dirname(abs);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(abs, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports: exportsObject,
      console,
      process,
      require: (name) => {
        if (!name.startsWith(".")) return require(name);
        const target = path.resolve(dir, name);
        const filePath = fs.existsSync(target) ? target : `${target}.ts`;
        return load(path.relative(__dirname, filePath));
      },
      ReadableStream,
      TextDecoder,
      AbortController,
      setTimeout,
      clearTimeout,
      fetch,
    },
  );
  return exportsObject;
}

const channel = load("../src/main/push/channel.ts");
const { requestLogs } = load("../src/main/diagnostics/requestLogs.ts");

function openStream(chunks, options = {}) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
      if (options.close) controller.close();
    },
  });
}

async function waitFor(predicate) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1000) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("push channel sends device and outlet headers and has no conversation id", async () => {
  requestLogs.clear();
  const messages = [];
  let connected = "";
  let resolveMessage = () => {};
  const received = new Promise((resolve) => {
    resolveMessage = resolve;
  });
  const calls = [];
  const session = channel.createPushSession({
    baseUrl: "http://localhost:3000/",
    deviceNumber: "dev-1",
    fetchImpl: async (url, init) => {
      calls.push({ url, headers: init.headers, signal: init.signal });
      return {
        ok: true,
        status: 200,
        body: openStream([
          'data: {"event":"connection","connection_id":"c1"}\n\n',
          'data: {"event":"heartbeat","connection_id":"c1"}\n\n',
          'data: {"event":"message","message_id":"m1"}\n\n',
        ]),
      };
    },
    onConnection: (id) => {
      connected = id;
    },
    onMessage: (event) => {
      messages.push(event);
      resolveMessage();
    },
    reconnect: { delayMs: 0, jitter: 0, exponentialBackoff: false },
  });
  session.sync("token-1", "outlet-a");
  session.sync("token-1", "outlet-a");
  await received;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:3000/channel/subscribe");
  assert.equal(calls[0].url.includes("conversation"), false);
  assert.equal(calls[0].headers["Device-Number"], "dev-1");
  assert.equal(calls[0].headers.DeviceNumber, undefined);
  assert.equal(calls[0].headers["Outlet-Code"], "outlet-a");
  assert.equal(calls[0].headers.OutletCode, undefined);
  assert.equal(calls[0].headers.Authorization, "Bearer token-1");
  assert.equal(calls[0].headers.Source, "omnivista-reply");
  assert.equal(calls[0].headers.source, undefined);
  assert.equal(calls[0].headers.Accept, "text/event-stream");
  assert.equal(connected, "c1");
  assert.deepEqual(
    messages.map((event) => event.event),
    ["message"],
  );
  const logs = requestLogs.list();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].method, "GET");
  assert.equal(logs[0].url, "http://localhost:3000/channel/subscribe");
  assert.equal(logs[0].state, "success");
  assert.equal(
    logs[0].response,
    'data: {"event":"connection","connection_id":"c1"}\n\n' +
      'data: {"event":"heartbeat","connection_id":"c1"}\n\n' +
      'data: {"event":"message","message_id":"m1"}\n\n',
  );
  session.sync();
  assert.equal(calls[0].signal.aborted, true);
});

test("push channel stays down without an outlet and reconnects after a failed response", async () => {
  requestLogs.clear();
  let calls = 0;
  let release;
  const opened = new Promise((resolve) => {
    release = resolve;
  });
  const session = channel.createPushSession({
    baseUrl: "http://localhost:3000",
    deviceNumber: "dev-1",
    fetchImpl: async (_url, init) => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 503, body: null };
      release(init.headers["Outlet-Code"]);
      return { ok: true, status: 200, body: openStream([]) };
    },
    reconnect: { delayMs: 0, jitter: 0, exponentialBackoff: false },
    onError: () => {},
  });
  session.sync("token-1");
  assert.equal(calls, 0);
  session.sync("token-1", "outlet-b");
  assert.equal(await opened, "outlet-b");
  assert.equal(calls, 2);
  const logs = requestLogs.list();
  assert.equal(logs[0].url, "http://localhost:3000/channel/subscribe");
  assert.equal(logs[0].status, 503);
  assert.equal(logs[0].state, "error");
  assert.equal(logs[1].state, "pending");
  session.stop();
});

test("push channel logs the raw body and reconnects after the stream ends", async () => {
  requestLogs.clear();
  let calls = 0;
  const raw = 'data: {"code":200,"msg":"已连接"}\n\n';
  const session = channel.createPushSession({
    baseUrl: "http://localhost:3000",
    deviceNumber: "dev-1",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 503,
          body: openStream(["服务不可用"], { close: true }),
        };
      }
      if (calls === 2) {
        return {
          ok: true,
          status: 200,
          body: openStream([raw], { close: true }),
        };
      }
      return { ok: true, status: 200, body: openStream([]) };
    },
    reconnect: { delayMs: 0, jitter: 0, exponentialBackoff: false },
    onError: () => {},
  });
  session.sync("token-1", "outlet-c");
  await waitFor(() => calls >= 3);
  const logs = requestLogs.list();
  assert.equal(logs[0].response, "服务不可用");
  assert.equal(logs[0].status, 503);
  assert.equal(logs[0].state, "error");
  assert.equal(logs[1].response, raw);
  assert.equal(logs[1].status, 200);
  assert.equal(logs[1].state, "success");
  session.stop();
});

test("reconnect delay doubles and stops at one minute", () => {
  const options = {
    delayMs: 1000,
    exponentialBackoff: true,
    backoffFactor: 2,
    maxDelayMs: 60_000,
    jitter: 0,
  };
  assert.equal(channel.reconnectDelayMs(1, options), 1000);
  assert.equal(channel.reconnectDelayMs(2, options), 2000);
  assert.equal(channel.reconnectDelayMs(6, options), 32_000);
  assert.equal(channel.reconnectDelayMs(7, options), 60_000);
  assert.equal(channel.reconnectDelayMs(12, options), 60_000);
});

test("device number is created once and reused", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-device-"));
  const exportsObject = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(path.join(__dirname, "../src/main/push/deviceId.ts"), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      },
    ).outputText,
    {
      exports: exportsObject,
      require: (name) =>
        name === "electron"
          ? { app: { getPath: () => dir } }
          : require(name),
    },
  );
  try {
    const first = exportsObject.getDeviceNumber();
    assert.equal(exportsObject.getDeviceNumber(), first);
    assert.equal(fs.readFileSync(path.join(dir, "device-id"), "utf8"), first);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
