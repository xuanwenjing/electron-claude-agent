const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const root = process.env.CLIENT_REPO || path.resolve(__dirname, "..");
const ts = require(path.join(root, "node_modules/typescript"));

test("session file roundtrip, server isolation and logout cleanup", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-auth-test-"));
  const env = { CLIENT_API_BASE_URL: "http://localhost:3000/" };
  const exportsObject = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(path.join(root, "src/main/auth/persistence.ts"), "utf8"),
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
      process: { platform: "darwin", env },
      require: (name) =>
        name === "electron"
          ? { app: { getPath: () => dir } }
          : require(require.resolve(name, { paths: [root] })),
    },
  );
  const store = new exportsObject.FileSessionPersistence();
  const saved = {
    token: "test-secret-token",
    expiresAt: Date.now() + 100000,
    outletCode: "b",
  };
  const file = path.join(dir, "auth-session.json");
  try {
    assert.equal(store.load(), null);
    store.save(saved);
    assert.deepEqual(JSON.parse(JSON.stringify(store.load())), saved);
    fs.writeFileSync(file, "{");
    assert.equal(store.load(), null);
    assert.equal(fs.existsSync(file), false);
    store.save(saved);
    env.CLIENT_API_BASE_URL = "http://different-server:3000";
    assert.equal(store.load(), null);
    assert.equal(fs.existsSync(file), false);
    env.CLIENT_API_BASE_URL = "http://localhost:3000/";
    store.save(saved);
    store.clear();
    assert.equal(store.load(), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
