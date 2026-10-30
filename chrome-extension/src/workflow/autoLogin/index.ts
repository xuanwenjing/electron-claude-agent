/**
 * 对齐 wormhole taskAutoLogin：依赖浏览器密码管理器已保存的账号密码，
 * CDP 真实点击输入框触发填充后点击登录。
 */
import { waitTabComplete } from "../browser";
import { LOGIN_URLS, PLATFORM_LABELS, isOnLoginPage } from "../platform";
import { HotelPlatform, type EmitFn } from "../types";
import { sleep } from "../util";
import { ensureTabWindowVisible } from "./cdp";
import { tryAutoLoginCtripEbk } from "./ctripEbk";
import { tryAutoLoginDouyin } from "./douyin";
import { AUTO_LOGIN_MAX_FAIL_COUNT, isAutoLoginDisabledToday, recordAutoLoginResult } from "./failLimit";
import { tryAutoLoginFliggy } from "./fliggy";
import { tryAutoLoginMeituan } from "./meituan";
import type { AutoLoginResult } from "./types";

export type { AutoLoginResult } from "./types";

type AutoLoginImpl = (tabId: number, emit: EmitFn) => Promise<AutoLoginResult>;

const AUTO_LOGIN_IMPLS: Partial<Record<HotelPlatform, AutoLoginImpl>> = {
  [HotelPlatform.CtripEbk]: (tabId) => tryAutoLoginCtripEbk(tabId),
  [HotelPlatform.Meituan]: (tabId, emit) => tryAutoLoginMeituan(tabId, emit),
  [HotelPlatform.Douyin]: (tabId) => tryAutoLoginDouyin(tabId),
  [HotelPlatform.Fliggy]: (tabId, emit) => tryAutoLoginFliggy(tabId, emit),
};

/**
 * 尝试自动登录：不在登录页则先打开平台登录页。
 * 成功后标签停留在平台登录后的落地页，由调用方重新打开目标页。
 */
export async function tryAutoLogin(
  tabId: number,
  platform: HotelPlatform,
  emit: EmitFn,
): Promise<AutoLoginResult> {
  const impl = AUTO_LOGIN_IMPLS[platform];
  const label = PLATFORM_LABELS[platform];
  if (!impl) return { success: false, errorMessage: `${label}暂不支持自动登录` };
  if (await isAutoLoginDisabledToday(platform)) {
    return { success: false, errorMessage: `${label}今日自动登录已失败 ${AUTO_LOGIN_MAX_FAIL_COUNT} 次，暂停自动登录` };
  }

  emit(`${label}未登录，尝试自动登录…`);
  const restoreWindow = await ensureTabWindowVisible(tabId);
  let result: AutoLoginResult;
  try {
    if (!(await isOnLoginPage(tabId, platform))) {
      await chrome.tabs.update(tabId, { url: LOGIN_URLS[platform][0] });
      await sleep(500);
    }
    // 可能刚跳到登录页还在加载（单页应用重定向），同样要等加载完
    await waitTabComplete(tabId, emit);
    result = await impl(tabId, emit);
  } catch (err) {
    result = { success: false, errorMessage: err instanceof Error ? err.message : String(err) };
  } finally {
    await restoreWindow();
  }

  const failCount = await recordAutoLoginResult(platform, result.success);
  if (!result.success && platform !== HotelPlatform.CtripEbk) {
    emit(`${label}今日自动登录失败 ${failCount}/${AUTO_LOGIN_MAX_FAIL_COUNT} 次`);
  }
  return result;
}
