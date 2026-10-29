import { isOnLoginPage } from "../platform";
import { sleep } from "../util";
import { AUTO_LOGIN_FAILED_MSG, type AutoLoginResult } from "./types";
import { sendCdpClickBySelector } from "./cdp";
import { HotelPlatform } from "../types";

const PHONE_INPUT = 'input[placeholder="手机号码"]';
const PASSWORD_INPUT = 'input[type="password"][placeholder="密码"]';
const LOGIN_BTN = '[data-cdp-target="douyin-login-btn"]';

/** 注入页面执行：必须自包含。确保进入密码登录模式 */
async function switchToPasswordLogin(): Promise<AutoLoginResult> {
  const findLeaf = (text: string) =>
    Array.from(document.querySelectorAll("*")).find(
      (el) => el.children.length === 0 && el.textContent?.trim() === text,
    ) as HTMLElement | undefined;

  const loginNow = findLeaf("立即登录");
  if (loginNow) {
    loginNow.click();
    await new Promise((r) => setTimeout(r, 2000));
  }

  const pwdLogin = findLeaf("密码登录");
  if (!pwdLogin) {
    if (document.querySelector('input[placeholder="密码"]')) return { success: true };
    return { success: false, errorMessage: "密码登录切换入口未找到" };
  }
  pwdLogin.click();
  await new Promise((r) => setTimeout(r, 4000));
  return { success: true };
}

/** 注入页面执行：必须自包含。同步 React 受控值、勾选协议、标记登录按钮 */
async function prepareLoginForm(): Promise<AutoLoginResult> {
  const phoneInput = document.querySelector('input[placeholder="手机号码"]') as HTMLInputElement | null;
  const passwordInput = document.querySelector('input[type="password"][placeholder="密码"]') as HTMLInputElement | null;
  if (!phoneInput?.value || !passwordInput?.value) {
    return {
      success: false,
      errorMessage: `密码管理器未填充手机号或密码（phone=${!!phoneInput?.value}, password=${!!passwordInput?.value}）`,
    };
  }

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  for (const input of [phoneInput, passwordInput]) {
    nativeSetter?.call(input, input.value || input.defaultValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  if (checkbox && !checkbox.checked) {
    checkbox.click();
    await new Promise((r) => setTimeout(r, 1000));
  }

  const loginBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "登录");
  if (!loginBtn) return { success: false, errorMessage: "登录按钮未找到" };
  loginBtn.scrollIntoView({ block: "center", inline: "center" });
  loginBtn.setAttribute("data-cdp-target", "douyin-login-btn");
  return { success: true };
}

export async function tryAutoLoginDouyin(tabId: number): Promise<AutoLoginResult> {
  const [switched] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: switchToPasswordLogin });
  if (!switched?.result?.success) {
    return switched?.result ?? { success: false, errorMessage: "切换密码登录模式失败" };
  }

  await sendCdpClickBySelector(tabId, PHONE_INPUT);
  await sleep(800);
  await sendCdpClickBySelector(tabId, PASSWORD_INPUT);
  await sleep(800);

  const [prepared] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: prepareLoginForm });
  if (!prepared?.result?.success) {
    return prepared?.result ?? { success: false, errorMessage: "登录脚本未返回结果" };
  }

  // 抖音登录按钮首次点击偶发无响应，间隔 2s 再点一次
  await sendCdpClickBySelector(tabId, LOGIN_BTN);
  await sleep(2000);
  await sendCdpClickBySelector(tabId, LOGIN_BTN);
  await sleep(4000);

  if (await isOnLoginPage(tabId, HotelPlatform.Douyin)) return { success: false, errorMessage: AUTO_LOGIN_FAILED_MSG };
  return { success: true };
}
