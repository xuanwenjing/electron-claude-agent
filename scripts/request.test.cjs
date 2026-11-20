const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function load() {
  const logExports = {};
  const logSource = ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../src/main/diagnostics/requestLogs.ts"),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(logSource, {
    exports: logExports,
    URL,
    URLSearchParams,
    FormData,
    Blob,
    require: (name) => {
      if (!name.startsWith(".")) return require(name);
      const target = path.resolve(
        path.dirname(path.join(__dirname, "../src/main/diagnostics/requestLogs.ts")),
        name,
      );
      const filePath = fs.existsSync(target) ? target : `${target}.ts`;
      const nested = {};
      vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
        { exports: nested, URL, URLSearchParams, FormData, Blob },
      );
      return nested;
    },
  });
  const exports = {};
  const code = ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../src/main/utils/request.ts"),
      "utf8",
    ),
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
    process,
    FormData,
    Blob,
    console: { error() {} },
    require: (name) =>
      name === "electron"
        ? { app: { getVersion: () => "0.3.5" } }
        : name === "../diagnostics/requestLogs"
          ? logExports
          : require(name),
  });
  return { ...exports, logs: logExports.requestLogs };
}
test("shared requests read current credentials and outlet on every call, clearing them on logout", async () => {
  const { request, setRequestContextProvider } = load();
  let context = {};
  setRequestContextProvider(() => context);
  const seen = [];
  const adapter = async (config) => {
    seen.push(config);
    return {
      data: { code: "success", data: {} },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  };
  const send = () =>
    request.request({
      url: "/api/test",
      adapter,
      headers: {
        Authorization: "spoof",
        "outlet-code": "old",
        outlet_code: "spoof",
        OutletCode: "spoof",
      },
    });
  assert.equal((await send()).code, 200);
  assert.equal(seen[0].headers.Authorization, undefined);
  context = { token: "first", outletCode: "a" };
  await send();
  assert.equal(seen[1].headers.Authorization, "Bearer first");
  assert.equal(seen[1].headers["Outlet-Code"], "a");
  assert.equal(seen[1].headers.OutletCode, undefined);
  assert.equal(seen[1].headers.outlet_code, undefined);
  context = { token: "second", outletCode: "b" };
  await send();
  assert.equal(seen[2].headers.Authorization, "Bearer second");
  assert.equal(seen[2].headers["Outlet-Code"], "b");
  assert.equal(seen[2].headers.OutletCode, undefined);
  assert.equal(seen[2].headers.outlet_code, undefined);
  context = { token: "no-outlets" };
  await send();
  assert.equal(seen[3].headers.Authorization, "Bearer no-outlets");
  assert.equal(seen[3].headers["Outlet-Code"], undefined);
  assert.equal(seen[3].headers.OutletCode, undefined);
  assert.equal(seen[3].headers.outlet_code, undefined);
  context = {};
  await send();
  assert.equal(seen[4].headers.Authorization, undefined);
  assert.equal(seen[4].headers["Outlet-Code"], undefined);
  assert.equal(seen[4].headers.OutletCode, undefined);
  assert.equal(seen[4].headers.outlet_code, undefined);
  await request.request(
    { url: "/api/auth/me", adapter },
    { token: "pending-login" },
  );
  assert.equal(seen[5].headers.Authorization, "Bearer pending-login");
  assert.equal(seen[5].headers["Client-Version"], "0.3.5");
  const form = new FormData();
  form.append("file", new Blob(["{}"], { type: "application/json" }), "report.json");
  await request.request({ url: "/file/uploadFile", method: "POST", data: form, adapter });
  const contentType = String(seen[6].headers["Content-Type"] ?? seen[6].headers["content-type"] ?? "");
  assert.equal(contentType.includes("application/json"), false);
  assert.equal(seen[6].data instanceof FormData, true);
});
test("request errors become plain responses without token or Axios config leakage", async () => {
  const { request } = load();
  const body = await request.request({
    url: "/api/test",
    adapter: async () => {
      throw Object.assign(new Error("network"), {
        response: { status: 403, data: { msg: "denied" } },
        config: { secret: "token" },
      });
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(body)), {
    code: 403,
    msg: "denied",
    data: null,
  });
});

test("Request records pending, success, business failure and network failure in the shared store", async () => {
  const previousBase = process.env.CLIENT_API_BASE_URL;
  delete process.env.CLIENT_API_BASE_URL;
  const { request, logs } = load();
  process.env.CLIENT_API_BASE_URL = "http://api.example.test";
  let finish;
  const pending = request.request({
    url: "/api/test",
    method: "POST",
    data: { sms_code: "123456" },
    adapter: (config) =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            data: { code: "success", data: { access_token: "secret" } },
            status: 200,
            statusText: "OK",
            headers: {},
            config,
          });
      }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(logs.list()[0].state, "pending");
  assert.equal(logs.list()[0].url, "http://api.example.test/api/test");
  finish();
  await pending;
  assert.equal(logs.list()[0].state, "success");
  assert.ok(JSON.stringify(logs.list()).includes("123456"));
  assert.ok(logs.list()[0].response.includes("secret"));
  await request.request({
    url: "/api/failure",
    adapter: async (config) => ({
      data: { code: "401", msg: "expired" },
      status: 200,
      headers: {},
      config,
    }),
  });
  assert.equal(logs.list()[1].state, "error");
  await request.request({
    url: "/api/network",
    adapter: async () => {
      throw Object.assign(new Error("failed"), { code: "ECONNREFUSED" });
    },
  });
  assert.equal(logs.list()[2].state, "error");
  assert.ok(logs.list()[2].response.includes("ECONNREFUSED"));
  if (previousBase === undefined) delete process.env.CLIENT_API_BASE_URL;
  else process.env.CLIENT_API_BASE_URL = previousBase;
});
