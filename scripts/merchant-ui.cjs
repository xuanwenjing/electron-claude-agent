const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = process.env.CLIENT_REPO || path.resolve(__dirname, "..");
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.join(
      root,
      "dist/renderer",
      req.url === "/" ? "index.html" : req.url.split("?")[0],
    );
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".html")
        ? "text/html"
        : file.endsWith(".css")
          ? "text/css"
          : "application/javascript",
    );
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : {}),
    });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const outlets = [
        { outlet_code: "a", outlet_name: "门店A", external_outlets: [] },
        { outlet_code: "b", outlet_name: "门店B", external_outlets: [] },
      ];
      const state = {
        user: { id: 1, name: "测试", mobile: "13800000001", outlets },
        outlet: outlets[0],
      };
      let sessionHandler;
      const test = (window.__test = {
        state,
        crawls: [],
        posts: [],
        cancels: [],
        refreshes: 0,
        failBind: false,
        failRefresh: false,
        holdBind: false,
      });
      test.switch = (code) => {
        state.outlet = outlets.find((item) => item.outlet_code === code);
        sessionHandler({ ...state });
      };
      test.finish = (index, extra = {}) => {
        const task = test.crawls[index];
        task.resolve({
          ok: true,
          data: {
            variables: {
              _hotelInfo: {
                platform: task.config.platform,
                isLogin: true,
                hotelInfo: { hotelName: "测试酒店", hotelCode: "hotel-1" },
              },
            },
          },
          ...extra,
        });
      };
      window.authApi = {
        getSession: async () => state,
        onSession: (fn) => {
          sessionHandler = fn;
          return () => {};
        },
        refresh: async () => {
          test.refreshes++;
          if (test.failRefresh) return { ok: false, error: "offline" };
          sessionHandler({ ...state });
          return { ok: true, session: state };
        },
      };
      window.requestApi = {
        post: async (url, data) => {
          test.posts.push({ url, data });
          if (test.holdBind)
            await new Promise((resolve) => {
              test.releaseBind = resolve;
            });
          if (test.failBind) return { code: 500, msg: "绑定失败测试" };
          const outlet = outlets.find(
            (item) => item.outlet_code === data.outlet_code,
          );
          outlet.external_outlets.push({
            group: data.platform,
            code: data.external_id,
            name: data.external_name,
          });
          return { code: 200, data: null };
        },
      };
      window.crawlApi = {
        start: (config, id) =>
          new Promise((resolve) => test.crawls.push({ config, id, resolve })),
        cancel: async (id) => {
          test.cancels.push(id);
          return { ok: true };
        },
        onStatus: () => () => {},
        onProgress: () => () => {},
        getStatus: async () => ({
          connected: true,
          port: 19283,
          extensionDir: "/test",
        }),
      };
      window.updateApi = {
        onStatus: () => () => {},
        meta: async () => ({ version: "0.3.5", packaged: true, busy: false }),
        getOpenAtLogin: async () => ({ supported: true, openAtLogin: false }),
      };
      window.requestLogsApi = {
        read: async () => ({ ok: true, data: [] }),
        clear: async () => ({ ok: true }),
      };
    });
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.getByRole("button", { name: "商家连接", exact: true }).click();
    const card = (name) =>
      page
        .getByRole("heading", { name, exact: true })
        .locator("..")
        .locator("..")
        .locator("..");
    for (const name of ["携程", "美团", "飞猪", "抖音"])
      await card(name).waitFor();
    const ctrip = card("携程");
    await ctrip.getByRole("button", { name: "连接商家" }).click();
    await page.evaluate(() => window.__test.finish(0));
    await ctrip.getByRole("button", { name: "确认绑定" }).waitFor();
    assert.equal(await page.evaluate(() => window.__test.posts.length), 0);
    await page.evaluate(() => {
      window.__test.failBind = true;
    });
    await ctrip.getByRole("button", { name: "确认绑定" }).click();
    await page.getByText("绑定失败测试", { exact: true }).waitFor();
    await page.evaluate(() => {
      window.__test.failBind = false;
      window.__test.holdBind = true;
      window.__test.failRefresh = true;
    });
    await ctrip.getByRole("button", { name: "确认绑定" }).click();
    await ctrip.getByRole("button", { name: "正在绑定…" }).waitFor();
    assert.equal(await page.evaluate(() => window.__test.posts.length), 2);
    await page.evaluate(() => {
      window.__test.releaseBind();
    });
    await ctrip.getByText("已绑定", { exact: true }).waitFor();
    await page
      .getByText("绑定成功，资料刷新失败，可稍后点击刷新状态")
      .waitFor();
    const posted = await page.evaluate(() => window.__test.posts[1]);
    assert.deepEqual(posted, {
      url: "/admin/outlets/bind",
      data: {
        outlet_code: "a",
        outlet_name: "门店A",
        platform: "ctripEbk",
        external_id: "hotel-1",
        external_name: "测试酒店",
      },
    });
    const mt = card("美团");
    await mt.getByRole("button", { name: "连接商家" }).click();
    await mt.getByRole("button", { name: "取消", exact: true }).click();
    await page.evaluate(() => window.__test.finish(1));
    await mt.getByRole("button", { name: "连接商家" }).waitFor();
    assert.equal(await page.evaluate(() => window.__test.cancels.length), 1);
    assert.equal(await mt.getByRole("button", { name: "确认绑定" }).count(), 0);
    await mt.getByRole("button", { name: "连接商家" }).click();
    await page.evaluate(() => {
      window.__test.switch("b");
      window.__test.finish(2);
    });
    await mt.getByRole("button", { name: "连接商家" }).waitFor();
    assert.equal(await mt.getByRole("button", { name: "确认绑定" }).count(), 0);
    await mt.getByRole("button", { name: "连接商家" }).click();
    await page.evaluate(() =>
      window.__test.finish(3, {
        data: {
          variables: {
            _hotelInfo: {
              platform: "douyin",
              isLogin: true,
              hotelInfo: { hotelName: "wrong", hotelCode: "wrong" },
            },
          },
        },
      }),
    );
    await mt.getByRole("button", { name: "重新获取" }).waitFor();
    assert.equal(await mt.getByRole("button", { name: "确认绑定" }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: four platforms, explicit confirmation, failed-bind retry, refresh failure, cancel, outlet switch and invalid result",
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
