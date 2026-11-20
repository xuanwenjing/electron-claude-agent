const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { test } = require("node:test");
const fs = require("node:fs");
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
    },
  );
  return exportsObject;
}

const bot = load("../src/main/agent/botPackage.ts", {
  "../auth": { authSession: { getRequestContext: () => ({ token: "t", outletCode: "outlet_001" }) } },
  "../utils/request": {
    request: {
      request: async (config) => {
        calls.push(config);
        return { code: 200, data: sample };
      },
    },
  },
});
const skill = load("../src/main/agent/skillPackage.ts", {
  electron: { net: {} },
  "adm-zip": class {},
});

const calls = [];
const sample = {
  bot_code: "commentator",
  published_version: 7,
  config_revision: 18,
  runtime: "claude_agent_sdk",
  system_prompt: "按任务参数处理评价 ${comment.content}",
  model: { name: "bot-configured-model", max_tokens: 1024, temperature: 0.3 },
  skills: [
    {
      skill_code: "review_reply",
      version: 7,
      download_url: "https://example.com/skill.zip",
      sha256: "abc",
      expires_at: "2099-01-01T00:00:00Z",
    },
  ],
  allowed_tools: ["list_reviews", "submit_reply"],
};

test("bot detail becomes the agent prompt, model and skills", async () => {
  const runtime = bot.parseBotRuntime(sample);
  assert.equal(runtime.botCode, "commentator");
  assert.equal(runtime.systemPrompt, "按任务参数处理评价 ${comment.content}");
  assert.equal(runtime.model, "bot-configured-model");
  assert.equal(runtime.skills.length, 1);
  assert.equal(runtime.skills[0].url, "https://example.com/skill.zip");
  assert.equal(runtime.skills[0].version, "7");
  assert.equal(runtime.skills[0].sha256, "abc");
  assert.equal((await bot.loadBotRuntime("commentator")).botCode, "commentator");
  assert.equal(calls[0].url, "/client/bots/commentator");
  assert.equal(calls[0].method, "GET");
  assert.throws(() => bot.parseBotRuntime({ ...sample, runtime: "other" }), /运行时不支持/);
  assert.throws(
    () =>
      bot.parseBotRuntime({
        ...sample,
        skills: [{ ...sample.skills[0], expires_at: "2000-01-01T00:00:00Z" }],
      }),
    /下载地址已过期/,
  );
});

test("skill zip must match sha256", () => {
  const body = Buffer.from("skill-zip");
  const hash = createHash("sha256").update(body).digest("hex");
  skill.assertSkillSha256(body, hash.toUpperCase());
  assert.throws(() => skill.assertSkillSha256(body, "00"), /SHA256/);
});
