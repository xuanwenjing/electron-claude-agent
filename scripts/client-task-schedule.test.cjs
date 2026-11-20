const assert = require("node:assert/strict");
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
      console,
    },
  );
  return exportsObject;
}

const cron = load("../src/main/tasks/cron.ts", {});
const { cronMatches, scheduledAtIso } = cron;
const { workflowOf } = load("../src/main/tasks/clientTask.ts", {
  "../utils/request": { request: { request: async () => ({ code: 500 }) } },
});
const { createTaskScheduler } = load("../src/main/tasks/schedule.ts", { "./cron": cron });

function at(iso) {
  return new Date(iso);
}

test("cron matches weekday, weekend, step, last day, nth weekday and year", () => {
  const thursdayNine = at("2026-11-19T01:00:00.000Z");
  const sundayNine = at("2026-11-22T01:00:00.000Z");
  const saturdayTenThirty = at("2026-11-21T02:30:00.000Z");
  const ten = at("2026-11-19T02:00:00.000Z");
  const lastDay = at("2026-11-30T01:00:00.000Z");
  const beforeLastDay = at("2026-11-29T01:00:00.000Z");
  const firstMonday = at("2026-11-02T01:00:00.000Z");
  const secondMonday = at("2026-11-09T01:00:00.000Z");

  assert.equal(cronMatches("0 0 9 * * 1-5", thursdayNine), true);
  assert.equal(cronMatches("0 0 9 * * 1-5", sundayNine), false);
  assert.equal(cronMatches("0 0 9 * * 0", sundayNine), true);
  assert.equal(cronMatches("0 0 9 * * 7", sundayNine), true);
  assert.equal(cronMatches("0 30 10 * * 0,6", saturdayTenThirty), true);
  assert.equal(cronMatches("0 0 */2 * * *", ten), true);
  assert.equal(cronMatches("0 0 */2 * * *", thursdayNine), false);
  assert.equal(cronMatches("0 0 9 L * *", lastDay), true);
  assert.equal(cronMatches("0 0 9 L * *", beforeLastDay), false);
  assert.equal(cronMatches("0 0 9 ? * 1#1", firstMonday), true);
  assert.equal(cronMatches("0 0 9 ? * 1#1", secondMonday), false);
  assert.equal(cronMatches("0 0 9 * * * 2026", thursdayNine), true);
  assert.equal(cronMatches("0 0 9 * * * 2027", thursdayNine), false);
  assert.equal(cronMatches("0 0 9 * * 1-5 2026-2028", thursdayNine), true);
  assert.equal(cronMatches("not cron", thursdayNine), false);
  assert.equal(scheduledAtIso(at("2026-11-19T01:00:20.000Z")), "2026-11-19T01:00:00Z");
});

test("a task without a top-level bot_code still enters the active list", async () => {
  const { listActiveTasks, parseClientTask } = load("../src/main/tasks/clientTask.ts", {
    "../utils/request": {
      request: {
        request: async () => ({
          code: 200,
          data: {
            total_page: 1,
            data_list: [
              {
                client_task_code: "task_7d5c6596b0f04ff79ffd6634f050d909",
                title: "tset",
                business_type: "REVIEW_REPLY",
                task_config: {
                  platform: "CtripHotel",
                  workflow: [{ type: "navigate", name: "open" }, { type: "call_api", name: "ddsss" }],
                  needLogin: false,
                },
                outlet_codes: ["outlet_159a4a6402e34fe08789b95973d667bf"],
                cron_expr: "0 * * * * ?",
                timezone: "Asia/Shanghai",
                status: "ACTIVE",
                config_revision: 9,
              },
            ],
          },
        }),
      },
    },
  });
  const outlet = "outlet_159a4a6402e34fe08789b95973d667bf";
  const tasks = await listActiveTasks(outlet);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].client_task_code, "task_7d5c6596b0f04ff79ffd6634f050d909");
  assert.equal(tasks[0].cron_expr, "0 * * * * ?");
  assert.equal(tasks[0].business_type, "REVIEW_REPLY");
  assert.equal(Object.hasOwn(tasks[0], "bot_code"), false);
  assert.equal(
    Object.hasOwn(
      parseClientTask({
        client_task_code: "x",
        business_type: "REVIEW_REPLY",
        cron_expr: "0 * * * * ?",
        status: "ACTIVE",
        bot_code: "ignored",
      }),
      "bot_code",
    ),
    false,
  );
  assert.throws(
    () => parseClientTask({ client_task_code: "task_bad", business_type: "REVIEW_REPLY", status: "ACTIVE" }),
    /任务配置无法解析 task_bad/,
  );
  assert.throws(
    () => parseClientTask({ client_task_code: "task_type", cron_expr: "0 * * * * ?", status: "ACTIVE" }),
    /business_type/,
  );
});

test("task_config is sent to the extension with run_agent bot details filled in", async () => {
  const loaded = [];
  const task = {
    client_task_code: "task_review_001",
    title: "回评",
    task_config: {
      maxRetry: 2,
      platform: "MeiTuan",
      needLogin: true,
      variables: { shop: "示例店" },
      workflow: [
        { type: "navigate", name: "open", url: "https://example.test/comments" },
        {
          type: "loop",
          children: [
            {
              type: "run_agent",
              name: "reply",
              save_as: "reply",
              run_agent_params: { bot_code: "commentator", output_format: "json", timeout: 180000 },
            },
            {
              type: "run_agent",
              name: "reply_again",
              run_agent_params: { bot_code: "commentator", output_format: "text" },
            },
          ],
        },
      ],
    },
    outlet_codes: ["outlet_001"],
    cron_expr: "0 0 9 * * 1-5",
    timezone: "Asia/Shanghai",
    status: "ACTIVE",
  };
  const bots = {
    commentator: {
      botCode: "commentator",
      systemPrompt: "回复 ${comment}",
      model: "claude",
      skills: [{ url: "https://example.test/skill.zip", version: "1", sha256: "abc" }],
    },
  };
  const config = await workflowOf(task, async (code) => {
    loaded.push(code);
    return { ...bots[code], systemPrompt: `回复 ${loaded.length}` };
  }, "inst_001");
  assert.equal(config.maxRetry, 2);
  assert.equal(config.platform, "MeiTuan");
  assert.equal(config.workflow[0].url, "https://example.test/comments");
  const step = config.workflow[1].children[0].run_agent_params;
  assert.equal(step.prompt, "回复 1");
  assert.equal(step.system_prompt, "回复 1");
  assert.equal(config.workflow[1].children[1].run_agent_params.prompt, "回复 2");
  assert.equal(step.model, "claude");
  assert.equal(step.skills[0].sha256, "abc");
  assert.equal(step.output_format, "json");
  assert.equal(step.timeout, 180000);
  assert.equal(step.bot_code, undefined);
  assert.equal(config.workflow[1].children[0].save_as, "reply");
  assert.equal(config.variables.shop, "示例店");
  assert.equal(config.variables.instance_code, "inst_001");
  assert.equal(config.variables.client_task_code, "task_review_001");
  assert.equal(task.task_config.workflow[1].children[0].run_agent_params.bot_code, "commentator");
  assert.equal(JSON.stringify(loaded), JSON.stringify(["commentator", "commentator"]));
});

function task(code, cronExpr, extra = {}) {
  return {
    client_task_code: code,
    title: code,
    task_config: {},
    outlet_codes: ["outlet_001"],
    cron_expr: cronExpr,
    timezone: "Asia/Shanghai",
    status: "ACTIVE",
    ...extra,
  };
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

test("push updates the schedule and only a matching minute starts the task", async () => {
  const started = [];
  let listed = [task("daily", "0 0 9 * * *")];
  let detail = task("daily", "0 30 10 * * *");
  let failList = false;
  const scheduler = createTaskScheduler({
    armed: false,
    client: {
      listActive: async () => {
        if (failList) throw new Error("网络失败");
        return listed;
      },
      get: async () => detail,
    },
    start: (item, date) => started.push(`${item.client_task_code}@${date.toISOString()}`),
  });

  scheduler.sync("token", "outlet_001");
  await flush();
  assert.equal(
    JSON.stringify(scheduler.tasks().map((item) => item.client_task_code)),
    JSON.stringify(["daily"]),
  );

  scheduler.onPush({
    event: "message",
    content: { event: "config.updated", client_task_code: "daily" },
  });
  await flush();
  assert.equal(scheduler.tasks()[0].cron_expr, "0 30 10 * * *");
  assert.deepEqual(started, []);

  scheduler.tick(at("2026-11-19T01:00:00.000Z"));
  scheduler.tick(at("2026-11-19T01:00:20.000Z"));
  assert.deepEqual(started, []);
  scheduler.tick(at("2026-11-19T02:30:00.000Z"));
  scheduler.tick(at("2026-11-19T02:30:20.000Z"));
  assert.equal(JSON.stringify(started), JSON.stringify(["daily@2026-11-19T02:30:00.000Z"]));

  detail = task("daily", "0 0 9 * * *", { status: "PAUSED" });
  scheduler.onPush({
    event: "message",
    content: { event: "config.updated", client_task_code: "daily" },
  });
  await flush();
  assert.equal(scheduler.tasks().length, 0);

  detail = task("other", "0 0 9 * * *", { outlet_codes: ["outlet_002"] });
  scheduler.onPush({
    event: "message",
    content: { event: "config.updated", client_task_code: "other" },
  });
  await flush();
  assert.equal(scheduler.tasks().length, 0);
  assert.equal(JSON.stringify(started), JSON.stringify(["daily@2026-11-19T02:30:00.000Z"]));
});

test("config.reset reloads the full task list and ignores an older in-flight list", async () => {
  const pending = [];
  const scheduler = createTaskScheduler({
    armed: false,
    client: {
      listActive: () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
      get: async () => null,
    },
    start: () => {
      throw new Error("reset 后不应执行");
    },
  });
  scheduler.sync("token", "outlet_001");
  scheduler.onPush({ event: "message", content: { event: "config.reset" } });
  assert.equal(pending.length, 2);
  pending[0]([task("stale", "0 0 9 * * *")]);
  await flush();
  assert.equal(scheduler.tasks().length, 0);
  pending[1]([task("daily", "0 0 9 * * *"), task("other", "0 30 10 * * *")]);
  await flush();
  assert.equal(
    JSON.stringify(scheduler.tasks().map((item) => item.client_task_code)),
    JSON.stringify(["daily", "other"]),
  );
});

test("a failed task list keeps the previous schedule", async () => {
  let failList = false;
  const scheduler = createTaskScheduler({
    armed: false,
    client: {
      listActive: async () => {
        if (failList) throw new Error("网络失败");
        return [task("daily", "0 0 9 * * *")];
      },
      get: async () => null,
    },
    start: () => {},
  });
  scheduler.sync("token", "outlet_001");
  await flush();
  failList = true;
  scheduler.sync("token", "outlet_001");
  await flush();
  assert.equal(
    JSON.stringify(scheduler.tasks().map((item) => item.client_task_code)),
    JSON.stringify(["daily"]),
  );
  scheduler.sync();
  assert.equal(scheduler.tasks().length, 0);
});
