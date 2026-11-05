const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = process.env.CLIENT_REPO || path.resolve(__dirname, "..");
const sourceRoot = process.env.CLIENT_SOURCE || root;
const ts = require(path.join(root, "node_modules/typescript"));
const platformExports = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(sourceRoot, "src/shared/merchant.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: platformExports },
);
const exportsObject = {};
let now = Date.now();
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(sourceRoot, "src/main/auth/session.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  {
    exports: exportsObject,
    require: (name) =>
      name === "../../shared/merchant"
        ? platformExports
        : require(require.resolve(name, { paths: [root] })),
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    setTimeout: () => ({ unref() {} }),
    clearTimeout() {},
  },
);
const { AuthSession } = exportsObject;
const outlets = [
  { outlet_code: "a", outlet_name: "门店A", external_outlets: [] },
  { outlet_code: "b", outlet_name: "门店B", external_outlets: [] },
];
function fixture({ stores = outlets, failProfile = false } = {}) {
  let active = false,
    cancels = 0;
  const calls = [];
  const session = new AuthSession(async (url, data, token) => {
    calls.push({ url, data, token });
    if (url.endsWith("loginByCode")) {
      if (data.sms_code !== "123456") throw Error("验证码错误");
      return { access_token: "secret", expire_at: 7200 };
    }
    if (url.endsWith("/me")) {
      if (token !== undefined) assert.equal(token, "secret");
      if (failProfile) throw Error("profile failed");
      return { id: 1, name: "员工", mobile: "13800138000", outlets: stores };
    }
    return true;
  });
  session.setTaskControl({
    hasActive: () => active,
    cancel: () => {
      cancels++;
      active = false;
    },
  });
  return {
    session,
    calls,
    setActive: (v) => (active = v),
    cancels: () => cancels,
  };
}
test("SMS login loads profile with bearer token and selects the first outlet", async () => {
  const f = fixture();
  await f.session.sendSms("13800138000");
  const state = await f.session.login("13800138000", "123456");
  assert.equal(state.outlet.outlet_code, "a");
  assert.equal(state.access_token, undefined);
  assert.equal(f.session.getRequestContext().outletCode, "a");
  assert.equal(f.calls[0].data.area_code, "86");
});
test("busy switch requires confirmation, cancelling leaves the old outlet and tasks untouched", async () => {
  const f = fixture();
  await f.session.login("13800138000", "123456");
  f.setActive(true);
  assert.equal(f.session.switchOutlet("b", false).confirmationRequired, true);
  assert.equal(f.session.getState().outlet.outlet_code, "a");
  assert.equal(f.cancels(), 0);
  const old = f.session.requireContext();
  assert.equal(f.session.switchOutlet("b", true).ok, true);
  assert.equal(f.cancels(), 1);
  assert.equal(f.session.isCurrent(old.revision), false);
  assert.equal(f.session.getRequestContext().outletCode, "b");
});
test("idle switch succeeds without confirmation and same-outlet selection does not cancel", async () => {
  const f = fixture();
  await f.session.login("13800138000", "123456");
  f.session.switchOutlet("a", false);
  assert.equal(f.cancels(), 0);
  assert.equal(f.session.switchOutlet("b", false).ok, true);
  assert.throws(() => f.session.switchOutlet("unknown", true), /无权/);
});
test("invalid login or failed profile request never establishes a session", async () => {
  const f = fixture();
  await assert.rejects(
    () => f.session.login("13800138000", "111111"),
    /验证码错误/,
  );
  assert.equal(f.session.getState().user, null);
  const bad = fixture({ failProfile: true });
  await assert.rejects(
    () => bad.session.login("13800138000", "123456"),
    /profile failed/,
  );
  assert.throws(() => bad.session.requireContext(), /请先登录/);
});
test("account without outlets cannot login or retain credentials, and can retry after assignment", async () => {
  const stores = [];
  const f = fixture({ stores });
  let changes = 0;
  f.session.onChange = () => changes++;
  await assert.rejects(
    () => f.session.login("13800138000", "123456"),
    /没有可用门店/,
  );
  assert.equal(f.session.getState().user, null);
  assert.equal(f.session.getState().outlet, null);
  assert.equal(f.session.getRequestContext().token, undefined);
  assert.equal(changes, 0);
  assert.throws(() => f.session.requireContext(), /请先登录/);
  stores.push(outlets[0]);
  await f.session.login("13800138000", "123456");
  assert.equal(f.session.getState().outlet.outlet_code, "a");
});
test("expiry cancels tasks and clears both token and outlet", async () => {
  const f = fixture();
  await f.session.login("13800138000", "123456");
  f.setActive(true);
  now += 7200001;
  assert.equal(f.session.getState().user, null);
  assert.equal(f.cancels(), 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(f.session.getRequestContext())),
    {},
  );
});
test("logout with active tasks respects confirmation", async () => {
  const f = fixture();
  await f.session.login("13800138000", "123456");
  f.setActive(true);
  assert.equal((await f.session.logout(false)).confirmationRequired, true);
  assert.equal(f.cancels(), 0);
  await f.session.logout(true);
  assert.equal(f.cancels(), 1);
  assert.equal(f.session.getState().user, null);
});

test("profile refresh preserves selected outlet and normalizes platform bindings", async () => {
  const stores = JSON.parse(JSON.stringify(outlets));
  const f = fixture({ stores });
  await f.session.login("13800138000", "123456");
  f.session.switchOutlet("b", false);
  const context = f.session.requireContext();
  stores[1].external_outlets.push({
    group: "MeiTuan",
    code: "hotel-1",
    name: "平台门店",
  });
  await f.session.refresh();
  assert.equal(f.session.getState().outlet.outlet_code, "b");
  assert.equal(f.session.getState().outlet.external_outlets[0].code, "hotel-1");
  assert.equal(
    f.session.getState().outlet.external_outlets[0].group,
    "meituan",
  );
  assert.equal(f.session.isCurrent(context.revision), true);
});

function persistedFixture(initial, stores = outlets) {
  let saved = initial;
  let failure;
  let calls = 0;
  const persistence = {
    load: () => saved,
    save: (value) => {
      saved = { ...value };
    },
    clear: () => {
      saved = null;
    },
  };
  const make = () =>
    new AuthSession(async (url, data, token) => {
      if (url.endsWith("loginByCode"))
        return { access_token: "secret", expire_at: 7200 };
      if (url.endsWith("/me")) {
        calls++;
        assert.equal(token, "secret");
        if (failure) throw failure;
        return { id: 1, name: "员工", mobile: "13800138000", outlets: stores };
      }
      return true;
    }, persistence);
  return {
    make,
    saved: () => saved,
    fail: (value) => {
      failure = value;
    },
    calls: () => calls,
  };
}
test("login persists absolute expiry; confirmed outlet survives a new session and logout removes it", async () => {
  const f = persistedFixture(null);
  const first = f.make();
  await first.login("13800138000", "123456");
  const expiry = f.saved().expiresAt;
  first.setTaskControl({ hasActive: () => true, cancel() {} });
  first.switchOutlet("b", false);
  assert.equal(f.saved().outletCode, "a");
  first.switchOutlet("b", true);
  const reopened = f.make();
  const state = await reopened.restore();
  assert.equal(state.outlet.outlet_code, "b");
  assert.equal(f.saved().expiresAt, expiry);
  assert.equal(state.token, undefined);
  await reopened.logout(true);
  assert.equal(f.saved(), null);
  assert.equal((await f.make().restore()).user, null);
});
test("restore validates before exposing token and coalesces concurrent calls", async () => {
  const f = persistedFixture({
    token: "secret",
    expiresAt: now + 100000,
    outletCode: "b",
  });
  const session = f.make();
  const pending = session.restore();
  assert.equal(session.getRequestContext().token, undefined);
  assert.equal(session.restore(), pending);
  await pending;
  assert.equal(f.calls(), 1);
  assert.equal(session.getRequestContext().token, "secret");
});
test("network error retains credentials and retry restores; missing outlet falls back to first", async () => {
  const f = persistedFixture({
    token: "secret",
    expiresAt: now + 100000,
    outletCode: "removed",
  });
  f.fail(new Error("offline"));
  const session = f.make();
  await assert.rejects(session.restore(), /暂时无法验证/);
  assert.equal(f.saved().token, "secret");
  assert.equal(session.getState().user, null);
  f.fail(null);
  assert.equal((await session.restore()).outlet.outlet_code, "a");
  assert.equal(f.saved().outletCode, "a");
});
test("expired, rejected and outlet-less sessions clear persisted credentials", async () => {
  for (const scenario of ["expired", "rejected", "no-outlets"]) {
    const f = persistedFixture(
      {
        token: "secret",
        expiresAt: now + (scenario === "expired" ? -1 : 100000),
        outletCode: "a",
      },
      scenario === "no-outlets" ? [] : outlets,
    );
    if (scenario === "rejected")
      f.fail(Object.assign(new Error("invalid"), { code: 401 }));
    assert.equal((await f.make().restore()).user, null);
    assert.equal(f.saved(), null);
    if (scenario === "expired") assert.equal(f.calls(), 0);
  }
});
