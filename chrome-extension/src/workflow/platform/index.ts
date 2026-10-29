/**
 * 平台定义：域名、名称、登录页。对齐 wormhole CROWLER_DOAMIN / loginUrlMap。
 */
import { HotelPlatform } from "../types";

export const PLATFORM_LABELS: Record<HotelPlatform, string> = {
  [HotelPlatform.CtripEbk]: "携程EBK",
  [HotelPlatform.CtripHotel]: "携程酒店",
  [HotelPlatform.Meituan]: "美团",
  [HotelPlatform.Douyin]: "抖音",
  [HotelPlatform.Fliggy]: "飞猪",
};

/** 平台业务页域名 → 平台（不含 passport 等登录域名） */
const PLATFORM_HOSTS: Record<string, HotelPlatform> = {
  "ebooking.ctrip.com": HotelPlatform.CtripEbk,
  "hotels.ctrip.com": HotelPlatform.CtripHotel,
  "me.meituan.com": HotelPlatform.Meituan,
  "eb.meituan.com": HotelPlatform.Meituan,
  "life.douyin.com": HotelPlatform.Douyin,
  "hotel.fliggy.com": HotelPlatform.Fliggy,
};

/** 各平台登录页（按前缀匹配，忽略 query）；第一项为自动登录时主动打开的地址 */
export const LOGIN_URLS: Record<HotelPlatform, string[]> = {
  [HotelPlatform.CtripEbk]: ["https://ebooking.ctrip.com/login"],
  [HotelPlatform.CtripHotel]: ["https://passport.ctrip.com/H5login/pc_login", "https://passport.ctrip.com/user/login"],
  [HotelPlatform.Meituan]: [
    "https://me.meituan.com/login/index.html",
    "https://epassport.meituan.com/new/login",
    "https://epassport.meituan.com/portal/oauth-login",
  ],
  [HotelPlatform.Douyin]: ["https://life.douyin.com/p/login"],
  [HotelPlatform.Fliggy]: [
    "https://hotel.fliggy.com/ebooking/login.htm",
    "https://ipassport.fliggy.net/mini_login.htm",
    "https://havanalogin.taobao.com/mini_login.htm",
  ],
};

export function detectPlatform(url: string | undefined): HotelPlatform | null {
  if (!url) return null;
  try {
    return PLATFORM_HOSTS[new URL(url).host] ?? null;
  } catch {
    return null;
  }
}

export function isLoginUrl(url: string | undefined, platform: HotelPlatform): boolean {
  const bare = (url || "").split("?")[0];
  return LOGIN_URLS[platform].some((loginUrl) => bare.startsWith(loginUrl));
}

export async function isOnLoginPage(tabId: number, platform: HotelPlatform): Promise<boolean> {
  const tab = await chrome.tabs.get(tabId);
  return isLoginUrl(tab.url, platform);
}
