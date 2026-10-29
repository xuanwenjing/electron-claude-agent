import { waitTabComplete } from "../browser";
import { getCachedHotelInfo } from "../hotelInfo";
import { isOnLoginPage } from "../platform";
import { HotelPlatform, type EmitFn } from "../types";
import { sleep } from "../util";
import { AUTO_LOGIN_FAILED_MSG, type AutoLoginResult } from "./types";
import { sendCdpClickBySelector } from "./cdp";

const PASSWORD_INPUT = 'input[placeholder*="密码"]';
const LOGIN_BTN = '[data-cdp-target="fliggy-login-btn"]';

/** 注入页面执行：必须自包含。输入账号并点击下一步 */
async function submitAccount(account: string): Promise<void> {
  const input = document.querySelector('input[placeholder="请输入账号"]') as HTMLInputElement | null;
  if (input) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, account);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  await new Promise((r) => setTimeout(r, 500));
  const nextBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("下一步"));
  nextBtn?.click();
}

/** 注入页面执行：必须自包含。同步密码受控值并标记登录按钮 */
function prepareLoginForm(): AutoLoginResult {
  const passwordInput = document.querySelector('input[placeholder*="密码"]') as HTMLInputElement | null;
  if (!passwordInput?.value) return { success: false, errorMessage: "密码管理器未填充密码" };

  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
    passwordInput,
    passwordInput.value || passwordInput.defaultValue,
  );
  passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
  passwordInput.dispatchEvent(new Event("change", { bubbles: true }));

  const loginBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "登录");
  if (!loginBtn) return { success: false, errorMessage: "登录按钮未找到" };
  loginBtn.scrollIntoView({ block: "center", inline: "center" });
  loginBtn.setAttribute("data-cdp-target", "fliggy-login-btn");
  return { success: true };
}

export async function tryAutoLoginFliggy(tabId: number, emit: EmitFn, configAccount?: string): Promise<AutoLoginResult> {
  // 未配置时用之前登录态下从页面接口捕获的 userNick
  const account = configAccount || (await getCachedHotelInfo(HotelPlatform.Fliggy))?.value.hotelInfo.userNick;
  if (!account) {
    return { success: false, errorMessage: "飞猪自动登录需要账号：请配置 WorkflowConfig.loginAccount，或先手动登录一次飞猪 EBK" };
  }

  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: submitAccount, args: [account] });
  await sleep(2000);

  // 密码表单在跨域 iframe 中，密码管理器无法填充，直接把标签导航到 iframe 地址
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const loginFrame = frames?.find(
    (f) => f.url.includes("ipassport.fliggy.net") || f.url.includes("havanalogin.taobao.com"),
  );
  if (!loginFrame) return { success: false, errorMessage: "未找到飞猪登录 iframe" };

  await chrome.tabs.update(tabId, { url: loginFrame.url });
  await sleep(500);
  await waitTabComplete(tabId, emit);
  await sleep(1500);

  await sendCdpClickBySelector(tabId, PASSWORD_INPUT);
  await sleep(800);

  const [prepared] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: prepareLoginForm });
  if (!prepared?.result?.success) {
    return prepared?.result ?? { success: false, errorMessage: "登录脚本未返回结果" };
  }

  await sendCdpClickBySelector(tabId, LOGIN_BTN);
  await sleep(4000);

  if (await isOnLoginPage(tabId, HotelPlatform.Fliggy)) return { success: false, errorMessage: AUTO_LOGIN_FAILED_MSG };
  return { success: true };
}
