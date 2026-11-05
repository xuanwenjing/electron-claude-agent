const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const ts = require("typescript");
test("hotel info must come from the current navigation and is not tied to a tab", async () => {
  const exports = {};
  let stored = {};
  const file = path.join(
    __dirname,
    "../chrome-extension/src/workflow/hotelInfo/xhrHotelInfo.ts",
  );
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      chrome: {
        storage: {
          local: {
            get: async () => stored,
            set: async (value) => (stored = value),
          },
        },
      },
      require: (name) =>
        name === "../types"
          ? {
              HotelPlatform: {
                Meituan: "meituan",
                Fliggy: "fliggy",
                Douyin: "douyin",
              },
            }
          : { sleep: async () => {} },
    },
  );
  const since = Date.now() - 1;
  await exports.captureHotelInfoFromXhr(
    {
      api: "/v1/ebooking/common/pois",
      response: { data: { poiId: "hotel-1", poiName: "酒店1" } },
    },
  );
  const correct = await exports.waitFreshHotelInfo(
    "meituan",
    since,
    100,
    async () => true,
  );
  assert.equal(correct.entry.value.hotelInfo.hotelCode, "hotel-1");
  assert.equal(
    (
      await exports.waitFreshHotelInfo(
        "meituan",
        since,
        100,
        async () => true,
      )
    ).entry.value.hotelInfo.hotelCode,
    "hotel-1",
  );
  assert.equal(
    (
      await exports.waitFreshHotelInfo(
        "meituan",
        Date.now() + 1000,
        100,
        async () => true,
      )
    ).entry,
    null,
  );
});

test("ordinary tasks use hotel info from the current navigation and never reuse stale information", async () => {
  const exports = {};
  let cachedReads = 0;
  let fresh = null;
  let url = "https://me.meituan.com/";
  const waits = [];
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        path.join(
          __dirname,
          "../chrome-extension/src/workflow/hotelInfo/index.ts",
        ),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports,
      chrome: { tabs: { get: async () => ({ url }) } },
      require: (name) =>
        ({
          "../platform": {
            detectPlatform: (value) =>
              value.includes("meituan") ? "meituan" : null,
            isLoginUrl: () => false,
            PLATFORM_LABELS: { meituan: "美团" },
          },
          "../types": {
            HotelPlatform: { CtripEbk: "ctripEbk", CtripHotel: "ctripHotel" },
          },
          "../variables": {
            setVariable: (collector, key, value) => {
              collector.variables[key] = value;
            },
          },
          "./xhrHotelInfo": {
            waitFreshHotelInfo: async (...args) => {
              waits.push(args);
              return { entry: fresh, stopped: false };
            },
            getCachedHotelInfo: async () => {
              cachedReads++;
              return {
                value: { hotelInfo: { hotelCode: "old", hotelName: "旧酒店" } },
              };
            },
          },
        })[name],
    },
  );
  const collector = {
    variables: { _hotelInfo: { hotelInfo: { hotelCode: "previous" } } },
    loopPath: [],
  };
  const logs = [];
  await exports.collectHotelInfo(
    22,
    collector,
    (message) => logs.push(message),
    1234,
  );
  assert.equal(waits[0][1], 1234);
  assert.equal(cachedReads, 0);
  assert.equal(collector.variables._hotelInfo, undefined);
  assert.ok(logs.some((message) => message.includes("未捕获到")));
  fresh = { value: { hotelInfo: { hotelCode: "new", hotelName: "新酒店" } } };
  await exports.collectHotelInfo(22, collector, () => {}, 1235);
  assert.equal(collector.variables._hotelInfo.hotelInfo.hotelCode, "new");
  assert.equal("fresh" in collector.variables._hotelInfo, false);
  url = "https://example.com/";
  await exports.collectHotelInfo(22, collector, () => {}, 1236);
  assert.equal(collector.variables._hotelInfo, undefined);
});
