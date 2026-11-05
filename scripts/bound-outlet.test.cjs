const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const file = path.join(
  __dirname,
  "../chrome-extension/src/workflow/boundOutlet.ts",
);
const exportsObject = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  {
    exports: exportsObject,
    require: (name) => {
      if (name === "./platform") {
        return { PLATFORM_LABELS: { meituan: "美团", ctripEbk: "携程EBK" } };
      }
      if (name === "./types") return { HotelPlatform: {} };
      throw new Error(name);
    },
  },
);
const { assertBoundOutlet, OutletMismatchError } = exportsObject;

test("bound platform store must match the captured store, otherwise the task stops", () => {
  assert.doesNotThrow(() =>
    assertBoundOutlet([{ group: "meituan", code: "hotel-1" }], {
      platform: "ctripEbk",
      hotelInfo: { hotelCode: "other" },
    }),
  );
  assert.doesNotThrow(() =>
    assertBoundOutlet([], {
      platform: "meituan",
      hotelInfo: { hotelCode: "hotel-9" },
    }),
  );
  assert.doesNotThrow(() =>
    assertBoundOutlet([{ group: "meituan", code: "hotel-1" }], {
      platform: "meituan",
      hotelInfo: { hotelCode: "hotel-1" },
    }),
  );
  assert.throws(
    () =>
      assertBoundOutlet([{ group: "meituan", code: "hotel-1" }], {
        platform: "meituan",
        hotelInfo: { hotelCode: "hotel-2" },
      }),
    (error) =>
      error instanceof OutletMismatchError &&
      /美团当前门店 hotel-2 与账号绑定的门店 hotel-1 不一致/.test(error.message),
  );
  assert.doesNotThrow(() =>
    assertBoundOutlet([{ group: "meituan", code: "hotel-1" }], {
      platform: "meituan",
    }),
  );
});
