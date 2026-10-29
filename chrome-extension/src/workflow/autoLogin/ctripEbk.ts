import { isOnLoginPage } from "../platform";
import { sleep } from "../util";
import { AUTO_LOGIN_FAILED_MSG, type AutoLoginResult } from "./types";
import { sendCdpClickBySelector } from "./cdp";
import { HotelPlatform } from "../types";

/** 注入页面执行：必须自包含。等待密码管理器填充后同步 React 受控值并点击登录 */
async function submitLoginForm(): Promise<AutoLoginResult> {
  const deadline = Date.now() + 8000;
  let usernameInput: HTMLInputElement | null = null;
  let passwordInput: HTMLInputElement | null = null;
  while (Date.now() < deadline) {
    usernameInput = document.querySelector('input[name="username-input"]');
    passwordInput = document.querySelector('input[name="password-input"]');
    if (usernameInput?.value && (passwordInput?.value || passwordInput?.defaultValue)) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  const hasUsername = !!usernameInput?.value;
  const hasPassword = !!(passwordInput?.value || passwordInput?.defaultValue);
  if (!usernameInput || !passwordInput) {
    return {
      success: false,
      errorMessage: `登录页未找到账号/密码输入框（username=${!!usernameInput}, password=${!!passwordInput}），可能不在账号密码登录模式`,
    };
  }
  if (!hasUsername || !hasPassword) {
    return {
      success: false,
      errorMessage: `密码管理器未填充账号密码（username=${hasUsername}, password=${hasPassword}），请确认该 Chrome 中已为 ebooking.ctrip.com 保存且仅保存一个账号`,
    };
  }

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  nativeSetter?.call(passwordInput, passwordInput!.value || passwordInput!.defaultValue);
  passwordInput!.dispatchEvent(new Event("input", { bubbles: true }));
  passwordInput!.dispatchEvent(new Event("change", { bubbles: true }));

  const loginBtn =
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "登录") ||
    (document.querySelector("#hotel-login-box-button") as HTMLButtonElement | null);
  if (!loginBtn) return { success: false, errorMessage: "登录按钮未找到" };
  loginBtn.click();
  return { success: true };
}

export async function tryAutoLoginCtripEbk(tabId: number): Promise<AutoLoginResult> {
  if (!(await sendCdpClickBySelector(tabId, 'input[name="password-input"]'))) {
    return { success: false, errorMessage: "登录页未找到密码输入框，可能不在账号密码登录模式" };
  }
  await sleep(1500);
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: submitLoginForm,
  });
  const result = injection?.result ?? { success: false as const, errorMessage: "登录脚本未返回结果" };
  if (!result.success) return result;

  await sleep(4000);
  if (await isOnLoginPage(tabId, HotelPlatform.CtripEbk)) return { success: false, errorMessage: AUTO_LOGIN_FAILED_MSG };
  return { success: true };
}
