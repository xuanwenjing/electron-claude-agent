import { waitTabComplete } from "../browser";
import { isOnLoginPage } from "../platform";
import { HotelPlatform, type EmitFn } from "../types";
import { sleep } from "../util";
import { AUTO_LOGIN_FAILED_MSG, type AutoLoginResult } from "./types";
import { sendCdpClickBySelector, setCrawlOverlayHidden, showClickIndicator } from "./cdp";

const LOGIN_BTN = '[data-cdp-target="meituan-login-btn"]';

/** 注入页面执行：必须自包含。检查填充、同步 React 受控值、可选勾选协议、标记登录按钮 */
async function prepareLoginForm(accountSel: string, passwordSel: string, checkboxSel: string | null): Promise<AutoLoginResult> {
  const accountInput = document.querySelector(accountSel) as HTMLInputElement | null;
  const passwordInput = document.querySelector(passwordSel) as HTMLInputElement | null;
  if (!accountInput?.value || !passwordInput?.value) {
    return {
      success: false,
      errorMessage: `密码管理器未填充账号或密码（account=${!!accountInput?.value}, password=${!!passwordInput?.value}）`,
    };
  }

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  for (const input of [accountInput, passwordInput]) {
    nativeSetter?.call(input, input.value || input.defaultValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (checkboxSel) {
    const checkbox = document.querySelector(checkboxSel) as HTMLInputElement | null;
    if (checkbox && !checkbox.checked) {
      checkbox.click();
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const loginBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "登录");
  if (!loginBtn) return { success: false, errorMessage: "登录按钮未找到" };
  loginBtn.scrollIntoView({ block: "center", inline: "center" });
  loginBtn.setAttribute("data-cdp-target", "meituan-login-btn");
  return { success: true };
}

async function fillAndSubmit(
  tabId: number,
  accountSel: string,
  passwordSel: string,
  checkboxSel: string | null,
): Promise<AutoLoginResult> {
  await sendCdpClickBySelector(tabId, accountSel);
  await sleep(800);
  await sendCdpClickBySelector(tabId, passwordSel);
  await sleep(800);

  const [prepared] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: prepareLoginForm,
    args: [accountSel, passwordSel, checkboxSel],
  });
  if (!prepared?.result?.success) {
    return prepared?.result ?? { success: false, errorMessage: "登录脚本未返回结果" };
  }

  await sendCdpClickBySelector(tabId, LOGIN_BTN);
  await sleep(2000);

  if ((await tryDragSlider(tabId)) === "failed") return { success: false, errorMessage: "滑块验证未通过" };

  await sleep(4000);
  if (await isOnLoginPage(tabId, HotelPlatform.Meituan)) return { success: false, errorMessage: AUTO_LOGIN_FAILED_MSG };
  return { success: true };
}

/** 新版直接登录页 epassport.meituan.com/new/login/*：验证码路由先切到账号登录 */
async function tryNewLoginPage(tabId: number): Promise<AutoLoginResult> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url?.includes("/new/login/account")) {
    const [switched] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (): AutoLoginResult => {
        const link = document.querySelector('a[href*="/new/login/account"]') as HTMLAnchorElement | null;
        if (!link) return { success: false, errorMessage: "未找到「账号登录」链接" };
        link.click();
        return { success: true };
      },
    });
    if (!switched?.result?.success) {
      return switched?.result ?? { success: false, errorMessage: "切换账号登录页失败" };
    }
    await sleep(1500);
  }
  return fillAndSubmit(tabId, 'input[placeholder="输入账号"]', 'input[placeholder="输入密码"]', null);
}

/** 旧版：登录表单在跨域 iframe 中，密码管理器无法填充，直接把标签导航到 iframe 地址 */
async function tryIframeLoginPage(tabId: number, emit: EmitFn): Promise<AutoLoginResult> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const loginFrame = frames?.find((f) => f.url.includes("epassport.meituan.com"));
  if (!loginFrame) return { success: false, errorMessage: "未找到美团登录 iframe" };

  await chrome.tabs.update(tabId, { url: loginFrame.url });
  await sleep(500);
  await waitTabComplete(tabId, emit);
  await sleep(1500);
  return fillAndSubmit(tabId, "input#login", "input#password", "input#checkbox");
}

export async function tryAutoLoginMeituan(tabId: number, emit: EmitFn): Promise<AutoLoginResult> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url?.includes("epassport.meituan.com/new/login")) return tryNewLoginPage(tabId);
  return tryIframeLoginPage(tabId, emit);
}

type SliderInfo = { left: number; top: number; width: number; height: number; dragDistance: number };

async function getSliderInfo(tabId: number): Promise<SliderInfo | null> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (): SliderInfo | null => {
      const slider = document.querySelector("#yodaBox") as HTMLElement | null;
      const track = document.querySelector("#yodaBoxWrapper") as HTMLElement | null;
      if (!slider || !track) return null;
      const s = slider.getBoundingClientRect();
      const t = track.getBoundingClientRect();
      return { left: s.left, top: s.top, width: s.width, height: s.height, dragDistance: Math.round(t.width - s.width) };
    },
  });
  return injection?.result ?? null;
}

/**
 * 美团滑块验证：用 CDP 模拟人手拖动（飘入 → 按下 → 加速/匀速/减速 + Y 抖动 → 超调回弹 → 释放）。
 * none：未出现滑块；done：拖动后滑块消失；failed：拖动后仍有滑块。
 */
async function tryDragSlider(tabId: number): Promise<"none" | "done" | "failed"> {
  if (!(await getSliderInfo(tabId))) return "none";

  const target = { tabId };
  const rnd = (min: number, max: number) => min + Math.random() * (max - min);
  const wait = (min: number, max: number) => new Promise((r) => setTimeout(r, rnd(min, max)));
  const move = (x: number, y: number, pressed: boolean) =>
    chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Math.round(x),
      y: Math.round(y),
      button: pressed ? "left" : "none",
      buttons: pressed ? 1 : 0,
      clickCount: 0,
    });

  await chrome.debugger.attach(target, "1.3");
  await setCrawlOverlayHidden(tabId, true);
  try {
    // attach 后顶部横条使布局下移，等稳定后重新取坐标
    await wait(800, 1600);
    const info = await getSliderInfo(tabId);
    if (!info) return "none";

    const startX = rnd(info.left + info.width * 0.3, info.left + info.width * 0.7);
    const startY = rnd(info.top + info.height * 0.25, info.top + info.height * 0.75);

    const approachX = startX - rnd(30, 60);
    const approachY = startY - rnd(5, 20);
    await move(approachX, approachY, false);
    await wait(100, 300);
    const approachSteps = 3 + Math.floor(Math.random() * 3);
    for (let i = 1; i <= approachSteps; i++) {
      const t = i / approachSteps;
      await move(approachX + (startX - approachX) * t, approachY + (startY - approachY) * t + (Math.random() - 0.5) * 3, false);
      await wait(30, 110);
    }
    await wait(150, 650);

    const pressX = Math.round(startX + (Math.random() - 0.5) * 2);
    const pressY = Math.round(startY + (Math.random() - 0.5) * 2);
    void showClickIndicator(tabId, pressX, pressY);
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: pressX,
      y: pressY,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await wait(60, 240);

    const totalSteps = 40 + Math.floor(Math.random() * 20);
    const overshoot = Math.round(rnd(5, 18));
    const totalDist = info.dragDistance + overshoot;
    let yDrift = 0;
    let prevX = pressX;
    let prevY = pressY;
    for (let i = 1; i <= totalSteps; i++) {
      const p = i / totalSteps;
      const eased = p < 0.4 ? (p / 0.4) ** 2 * 0.5 : p < 0.8 ? 0.5 + ((p - 0.4) / 0.4) * 0.4 : 0.9 + ((p - 0.8) / 0.2) * 0.1;
      const noised = Math.max(0, Math.min(1, eased + rnd(-0.05, 0.05) * (1 - Math.abs(eased - 0.5) * 2)));
      yDrift = Math.max(-8, Math.min(8, yDrift + (Math.random() - 0.5) * 4));
      const jitter = Math.random() < 0.1 ? Math.round((Math.random() - 0.5) * 4) : 0;
      prevX = Math.round(pressX + totalDist * noised) + jitter;
      prevY = Math.round(pressY + yDrift);
      await move(prevX, prevY, true);
      const speed = p < 0.4 ? 0.5 : p > 0.8 ? 1.5 : 1;
      await new Promise((r) => setTimeout(r, Math.round((8 + Math.random() * 25) * speed)));
    }

    await wait(40, 120);
    const finalX = Math.round(pressX + info.dragDistance);
    const finalY = Math.round(pressY + yDrift * 0.3 + (Math.random() - 0.5) * 2);
    const bounceSteps = 2 + Math.floor(Math.random() * 3);
    for (let i = 1; i <= bounceSteps; i++) {
      const t = i / bounceSteps;
      await move(prevX + (finalX - prevX) * t, prevY + (finalY - prevY) * t, true);
      await wait(15, 45);
    }
    await wait(30, 110);
    void showClickIndicator(tabId, finalX, finalY);
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: finalX,
      y: finalY,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
  } finally {
    await setCrawlOverlayHidden(tabId, false);
    await chrome.debugger.detach(target).catch(() => {});
  }

  await sleep(3000);
  return (await getSliderInfo(tabId)) ? "failed" : "done";
}
