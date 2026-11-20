const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EventEmitter } = require("node:events");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const root = process.env.CLIENT_REPO || path.resolve(__dirname, "..");
const sourceRoot = process.env.CLIENT_SOURCE || root;
const ts = require(path.join(root, "node_modules/typescript"));
function load(file, mocks, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(
    fs.readFileSync(path.join(sourceRoot, file), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (name) => mocks[name] ?? require(name),
    console,
    ...globals,
  });
  return exports;
}
const manager = () => load("src/main/crawl/taskManager.ts", {});
const protocol = load("src/shared/bridgeProtocol.ts", {});
test("crawl IPC returns final results directly, retries once and cancels pending preparation", async () => {
  const tasks = manager();
  let server, connected, restarted;
  const handlers = {},
    sent = [],
    reports = [],
    events = [];
  class Server extends EventEmitter {
    constructor() {
      super();
      server = this;
    }
  }
  const bridge = load(
    "src/main/crawl/bridgeServer.ts",
    {
      "./taskManager": tasks,
      ws: { WebSocketServer: Server },
      "../../shared/bridgeProtocol": protocol,
      "../agent/workflowAgent": {
        cancelAllWorkflowAgents() {},
        endWorkflowTask: async () => {},
        cancelWorkflowAgent() {},
      },
    },
    { setInterval: () => 1, clearInterval() {} },
  );
  const api = load("src/main/ipc/crawl.ts", {
    electron: {
      ipcMain: {
        handle: (name, fn) => {
          handlers[name] = fn;
        },
      },
    },
    "../../shared/bridgeProtocol": protocol,
    "../crawl/taskManager": tasks,
    "../crawl/bridgeServer": bridge,
    "../crawl/edgeBrowser": {
      ensureExtensionConnected: () =>
        new Promise((resolve) => {
          connected = resolve;
        }),
      restartEdgeWithSiteUnblocked: () =>
        new Promise((resolve) => {
          restarted = resolve;
        }),
    },
    "../update/extensionUpdater": { flushPendingExtensionReload() {} },
    "../window": { sendToRenderer: (...args) => events.push(args) },
    "../auth": { authSession: { getState: () => ({ outlet: null }) } },
    "../../shared/merchant": {
      HotelPlatform: {
        CtripEbk: "CtripEbk",
        CtripHotel: "CtripHotel",
        Meituan: "MeiTuan",
        Douyin: "DouYin",
        Fliggy: "Fliggy",
      },
      normalizePlatform: (value) => {
        switch (String(value).toLowerCase()) {
          case "ctrip":
          case "ctripebk":
            return "CtripEbk";
          case "ctriphotel":
            return "CtripHotel";
          case "meituan":
            return "MeiTuan";
          case "fliggy":
            return "Fliggy";
          case "douyin":
            return "DouYin";
          default:
            return value;
        }
      },
      PLATFORM_LABELS: {
        CtripEbk: "携程EBK",
        CtripHotel: "携程酒店",
        MeiTuan: "美团",
        DouYin: "抖音",
        Fliggy: "飞猪",
      },
    },
  });
  api.registerCrawlIpc();
  api.startCrawlBridge();
  const unbound = await api.startCrawl(
    { platform: "MeiTuan", workflow: [] },
    "binding-check",
    { checkBinding: true },
  );
  assert.equal(unbound.ok, false);
  assert.equal(unbound.errorCode, protocol.TaskErrorCode.OutletMismatch);
  assert.match(unbound.error, /账号未绑定美团门店/);
  assert.equal(unbound.report.ok, false);
  assert.equal(unbound.report.errorCode, protocol.TaskErrorCode.OutletMismatch);
  assert.match(unbound.report.error, /账号未绑定美团门店/);
  assert.equal(unbound.report.clientTaskCode, undefined);
  const typed = await api.startCrawl(
    { platform: "MeiTuan", workflow: [] },
    "inst_001",
    {
      checkBinding: true,
      businessType: "REVIEW_REPLY",
      clientTaskCode: "task_review_001",
    },
  );
  assert.equal(typed.taskId, "inst_001");
  assert.equal(typed.report.taskId, "inst_001");
  assert.equal(typed.report.clientTaskCode, "task_review_001");
  assert.equal(typed.report.instanceCode, undefined);
  assert.equal(typed.report.businessType, "REVIEW_REPLY");
  assert.equal(tasks.crawlTasks.list().length, 0);
  assert.equal(
    api.scheduledOutletError("meituan", [{ group: "MeiTuan", code: "hotel-1" }]),
    null,
  );
  assert.match(
    api.scheduledOutletError("CtripHotel", [{ group: "CtripEbk", code: "445011" }]),
    /账号未绑定携程酒店门店/,
  );
  const socket = new EventEmitter();
  socket.OPEN = 1;
  socket.readyState = 1;
  socket.send = (value) => sent.push(JSON.parse(value));
  server.emit("connection", socket);
  const receive = (data) => socket.emit("message", JSON.stringify(data));
  receive({ type: "hello", role: "extension" });
  const tick = () => new Promise(setImmediate);
  const config = { platform: "meituan", workflow: [] };
  const suppliedId = "12345678-1234-4234-8234-123456789abc";
  let pending = handlers["crawl:start"]({}, config, suppliedId);
  assert.equal(tasks.crawlTasks.list()[0].taskId, suppliedId);
  const duplicate = await handlers["crawl:start"]({}, config, suppliedId);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, "任务已存在");
  assert.equal(duplicate.report.ok, false);
  assert.equal(duplicate.report.error, "任务已存在");
  assert.equal(duplicate.report.errorCode, protocol.TaskErrorCode.InvalidTask);
  assert.equal((await handlers["crawl:cancel"]({}, "")).ok, true);
  await tick();
  assert.equal(handlers["crawl:cancel"]({}, suppliedId).ok, true);
  const cancelled = await pending;
  assert.equal(cancelled.errorCode, protocol.TaskErrorCode.Cancelled);
  connected({ ok: true });
  await tick();
  assert.equal(sent.filter((x) => x.type === "start_task").length, 0);
  reports.push(cancelled.report);
  assert.equal(cancelled.report.config, config);

  pending = handlers["crawl:start"]({}, config, "run-1");
  await tick();
  connected({ ok: true });
  await tick();
  let done = false;
  pending.then(() => {
    done = true;
  });
  await tick();
  assert.equal(done, false);
  let id = tasks.crawlTasks.list()[0].taskId;
  receive({
    type: "task_result",
    taskId: id,
    ok: true,
    data: { hotel: "one" },
  });
  let result = await pending;
  assert.equal(result.data.hotel, "one");
  assert.equal(result.report.data.hotel, "one");
  assert.equal(result.report.config, config);
  reports.push(result.report);

  pending = handlers["crawl:start"]({}, config, "run-2");
  await tick();
  connected({ ok: true });
  await tick();
  id = tasks.crawlTasks.list()[0].taskId;
  receive({
    type: "task_result",
    taskId: id,
    ok: false,
    errorCode: protocol.TaskErrorCode.SiteBlocked,
    blockedOrigin: "https://example.com",
  });
  await tick();
  assert.ok(tasks.crawlTasks.hasActive());
  api.cancelAllClientCrawls("cancel retry");
  const retried = await pending;
  assert.equal(retried.errorCode, protocol.TaskErrorCode.Cancelled);
  reports.push(retried.report);
  const count = sent.length;
  restarted({ ok: true });
  await tick();
  assert.equal(sent.length, count);

  pending = handlers["crawl:start"]({}, config, "run-3");
  await tick();
  connected({ ok: true });
  await tick();
  id = tasks.crawlTasks.list()[0].taskId;
  const blocked = {
    type: "task_result",
    taskId: id,
    ok: false,
    errorCode: protocol.TaskErrorCode.SiteBlocked,
    blockedOrigin: "https://example.com",
  };
  receive(blocked);
  await tick();
  restarted({ ok: true });
  await tick();
  receive(blocked);
  result = await pending;
  assert.equal(result.errorCode, protocol.TaskErrorCode.SiteBlocked);
  assert.equal(tasks.crawlTasks.hasActive(), false);
  reports.push(result.report);
  assert.equal(reports.length, 4);
  assert.equal(
    events.some(([name]) => name === "crawl:event:result"),
    false,
  );
  const badConfig = await handlers["crawl:start"]({}, null, "run-4");
  assert.equal(badConfig.ok, false);
  assert.equal(badConfig.report.error, "抓取配置必须为对象");
  const missingId = await handlers["crawl:start"]({}, config, "");
  assert.equal(missingId.ok, false);
  assert.equal(missingId.report.error, "任务编号不能为空");
  const absentId = await handlers["crawl:start"]({}, config);
  assert.equal(absentId.ok, false);
  assert.equal(absentId.report.error, "任务编号不能为空");
  const custom = handlers["crawl:start"]({}, config, "../bad-id");
  await tick();
  connected({ ok: true });
  await tick();
  const customId = tasks.crawlTasks.list()[0].taskId;
  assert.equal(customId, "../bad-id");
  receive({ type: "task_result", taskId: customId, ok: true });
  assert.equal((await custom).ok, true);
});
test("bridge sends cancellation, aborts agents and ignores late result/progress/agent requests", async () => {
  let server,
    aborted = 0,
    runs = 0;
  const results = [],
    progress = [];
  class Server extends EventEmitter {
    constructor() {
      super();
      server = this;
    }
  }
  const api = load(
    "src/main/crawl/bridgeServer.ts",
    {
      "./taskManager": manager(),
      ws: { WebSocketServer: Server },
      "../../shared/bridgeProtocol": protocol,
      "../agent/workflowAgent": {
        cancelAllWorkflowAgents: () => aborted++,
        endWorkflowTask: async () => {},
        runWorkflowAgent: async () => {
          runs++;
        },
        cancelWorkflowAgent() {},
      },
    },
    { setInterval: () => 1, clearInterval() {} },
  );
  api.startBridgeServer({
    onStatus() {},
    onProgress: (...p) => progress.push(p),
  });
  const socket = new EventEmitter();
  socket.OPEN = 1;
  socket.readyState = 1;
  socket.sent = [];
  socket.send = (s) => socket.sent.push(JSON.parse(s));
  server.emit("connection", socket);
  const receive = (m) => socket.emit("message", JSON.stringify(m));
  receive({ type: "hello", role: "extension" });
  const oldResult = api.runCrawlTask({}, { taskId: "old-task" });
  api.cancelAllCrawlTasks("切换门店");
  assert.equal(socket.sent.at(-1).type, "cancel_task");
  assert.equal(aborted, 1);
  results.push(await oldResult);
  assert.equal(results[0].errorCode, "CANCELLED");
  receive({ type: "task_result", taskId: "old-task", ok: true });
  receive({ type: "task_progress", taskId: "old-task", message: "late" });
  receive({
    type: "run_agent",
    requestId: "agent",
    taskId: "old-task",
    params: { prompt: "late" },
  });
  assert.equal(results.length, 1);
  assert.equal(progress.length, 0);
  assert.equal(runs, 0);
  const newResult = api.runCrawlTask({}, { taskId: "new-task" });
  receive({ type: "task_result", taskId: "new-task", ok: true });
  results.push(await newResult);
  assert.equal(results.length, 2);
  assert.equal(results[1].taskId, "new-task");
});
test("runCrawlTask awaits results and settles on send failure, cancellation and disconnect", async () => {
  const tasks = manager();
  let server;
  class Server extends EventEmitter {
    constructor() {
      super();
      server = this;
    }
  }
  const api = load(
    "src/main/crawl/bridgeServer.ts",
    {
      "./taskManager": tasks,
      ws: { WebSocketServer: Server },
      "../../shared/bridgeProtocol": protocol,
      "../agent/workflowAgent": {
        cancelAllWorkflowAgents() {},
        endWorkflowTask: async () => {},
        cancelWorkflowAgent() {},
      },
    },
    { setInterval: () => 1, clearInterval() {} },
  );
  api.startBridgeServer({
    onStatus() {},
    onProgress() {},
  });
  const connect = () => {
    const socket = new EventEmitter();
    socket.OPEN = 1;
    socket.readyState = 1;
    socket.send = () => {};
    server.emit("connection", socket);
    socket.emit(
      "message",
      JSON.stringify({ type: "hello", role: "extension" }),
    );
    return socket;
  };
  let socket = connect();
  let settled = false;
  const pending = api.runCrawlTask({}, { taskId: "success" }).then((r) => {
    settled = true;
    return r;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  socket.emit(
    "message",
    JSON.stringify({
      type: "task_result",
      taskId: "success",
      ok: true,
      data: { value: 7 },
    }),
  );
  assert.equal((await pending).data.value, 7);
  assert.equal(tasks.crawlTasks.get("success"), undefined);
  const cancel = api.runCrawlTask({}, { taskId: "cancel" });
  api.cancelCrawlTask("cancel");
  assert.equal((await cancel).errorCode, protocol.TaskErrorCode.Cancelled);
  const disconnected = api.runCrawlTask({}, { taskId: "disconnect" });
  socket.emit("close");
  assert.equal(
    (await disconnected).errorCode,
    protocol.TaskErrorCode.ExtensionDisconnected,
  );
  assert.equal((await api.runCrawlTask({}, { taskId: "offline" })).ok, false);
  socket = connect();
  socket.send = () => {
    throw Error("send failed");
  };
  assert.match(
    (await api.runCrawlTask({}, { taskId: "send-error" })).error,
    /send failed/,
  );
  socket.send = () => {};
  const all = api.runCrawlTask({}, { taskId: "switch" });
  socket.send = () => {
    throw Error("closed during cancel");
  };
  api.cancelAllCrawlTasks("switch outlet");
  assert.equal((await all).errorCode, protocol.TaskErrorCode.Cancelled);
  assert.equal(tasks.crawlTasks.list().length, 0);
});

test("crawl execution state has no merchant or authentication fields", () => {
  const source = fs.readFileSync(
    path.join(sourceRoot, "src/main/crawl/taskManager.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /MerchantTask|merchant|outletCode|revision|awaiting-confirm|binding/,
  );
  const bridge = fs.readFileSync(
    path.join(sourceRoot, "src/main/crawl/bridgeServer.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    bridge,
    /retainTask|task\.merchant|options\.outletCode|options\.revision/,
  );
});

test("renderer keeps extension status and does not dispatch crawl tasks", async () => {
  const api = {
    onStatus: () => () => {},
    onProgress: (listener) => {
      listener({ taskId: "task-12345678", message: "步骤完成" });
      return () => {};
    },
    getStatus: async () => ({
      connected: true,
      port: 19283,
      extensionDir: "/tmp/ext",
    }),
  };
  const { useCrawlStore } = load(
    "src/renderer/stores/useCrawlStore.ts",
    { "../../shared/bridgeProtocol": protocol },
    { window: { crawlApi: api } },
  );
  useCrawlStore.getState().init();
  assert.equal(useCrawlStore.getState().start, undefined);
  await Promise.resolve();
  assert.equal(useCrawlStore.getState().connected, true);
  assert.equal(useCrawlStore.getState().extensionDir, "/tmp/ext");
  assert.match(useCrawlStore.getState().logs.at(-1).text, /步骤完成/);
});
