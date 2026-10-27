/**
 * 对齐 wormhole content-common/matches/dataInjector：
 * navigate 结束后，若落在携程 EBK / 携程酒店页，在页面 MAIN world 提取酒店信息写入 collector
 */
import type { Collector, EmitFn, HotelPlatform } from "../types";

export const HOTEL_INFO_KEY = "hotelInfo";

const HOTEL_HOSTS: Record<string, HotelPlatform> = {
  "ebooking.ctrip.com": "ctripEbk",
  "hotels.ctrip.com": "ctripHotel",
};

/**
 * 注入页面执行：必须自包含，不能引用外部变量。
 * HEAppInfo 由 EBK 前端异步挂载，轮询等待。
 */
async function extractCtripEbkInfo(timeoutMs: number) {
  type HEAppInfo = { getHotelInfo?: () => unknown; getUserInfo?: () => unknown };
  const getApp = () => (window as unknown as { HEAppInfo?: HEAppInfo }).HEAppInfo;
  const deadline = Date.now() + timeoutMs;
  while (!getApp()?.getHotelInfo && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
  }
  const app = getApp();
  if (!app?.getHotelInfo) return { isLogin: false};


  const hotelInfo: Record<string, string> = {};

  const ebkHotelInfo = (app.getHotelInfo?.() || {}) as Record<string, string>;
  const ebkUserInfo = (app.getUserInfo?.() || {}) as Record<string, string>;
  hotelInfo.hotelName = ebkHotelInfo.hotelCName || ""; // 取中文酒店名
  hotelInfo.hotelNameEn = ebkHotelInfo.hotelEName || ""; // 取中文酒店名
  hotelInfo.hotelCode = ebkHotelInfo.masterHotelId?.toString() || "";

  return { hotelInfo, ebkHotelInfo, ebkUserInfo, isLogin: true };
}

/** 注入页面执行：必须自包含，不能引用外部变量 */
function extractCtripHotelInfo() {
  const parseCustomFormatString = (str: string) => {
    const trimmed = str.trim();
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) throw new Error("Invalid format: missing colon separator");
    const data = JSON.parse(trimmed.substring(colonIndex + 1));
    if (Array.isArray(data.chunks)) {
      data.chunks = data.chunks.map((chunk: string) => {
        const colonPos = chunk.indexOf(":");
        if (colonPos === -1) return { id: null, name: chunk };
        return { id: chunk.substring(0, colonPos), name: chunk.substring(colonPos + 1) };
      });
    }
    return { key: trimmed.substring(0, colonIndex), ...data };
  };

  const extractNewIbuHotelData = () => {
    try {
      const prefix = 'self.__next_f.push([1,"Ja:';
      const script = Array.from(document.querySelectorAll("body > script")).find((el) =>
        (el.textContent || "").startsWith(prefix),
      );
      const targetText = script?.textContent || "";
      if (!targetText) return null;
      const json = JSON.parse(targetText.slice(19, targetText.length - 1));
      const formatObj = parseCustomFormatString(json[1]) as Record<string, any>;
      for (const key of Object.keys(formatObj)) {
        const data = formatObj[key];
        if (!data?.pageId) continue;
        delete data.ctripPageHeaderContent;
        delete data.qConfigData;
        delete data.translate;
        delete data.abTest;
        delete data.seoHeadData;
        delete data.seoSSRData;
        delete data.ssrHotelRoomListRequest;
        delete data.hotelCommentResponse;
        return data;
      }
      return null;
    } catch {
      return null;
    }
  };

  const hotelInfo: Record<string, string> = {};
  const newIbuHotelData = extractNewIbuHotelData();
  hotelInfo.hotelName = newIbuHotelData?.hotelDetailResponse?.hotelBaseInfo?.nameInfo?.name?.toString() || "";
  hotelInfo.hotelNameEn = newIbuHotelData?.hotelDetailResponse?.hotelBaseInfo?.nameInfo?.nameEn?.toString() || "";

  const hotelCode = newIbuHotelData?.hotelDetailResponse?.hotelBaseInfo?.masterHotelId?.toString() || "";
  hotelInfo.hotelCode = hotelCode;

  return {
    hotelInfo,
    newIbuHotelData,
    isLogin: newIbuHotelData?.hotelDetailResponse?.authInfo?.isLogin ?? false,
  };
}

export const PLATFORM_LABELS: Record<HotelPlatform, string> = {
  ctripEbk: "携程EBK",
  ctripHotel: "携程酒店",
};

/** 登录校验失败：重试无意义，runWorkflow 直接结束任务 */
export class NotLoggedInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotLoggedInError";
  }
}

export function detectPlatform(url: string | undefined): HotelPlatform | null {
  if (!url) return null;
  try {
    return HOTEL_HOSTS[new URL(url).host] ?? null;
  } catch {
    return null;
  }
}

export type HotelInfoResult = { platform: HotelPlatform; isLogin: boolean } | null;

/**
 * 按标签当前 URL（含重定向后）判断平台，提取酒店信息写入
 * collector.data.hotelInfo 与 collector.variables.hotelInfo。
 * 提取失败只记日志，不中断 workflow；不在已知平台页时返回 null。
 */
export async function collectHotelInfo(tabId: number, collector: Collector, emit: EmitFn): Promise<HotelInfoResult> {
  const tab = await chrome.tabs.get(tabId);
  const platform = detectPlatform(tab.url);
  if (!platform) return null;

  try {
    const [injection] =
      platform === "ctripEbk"
        ? await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: extractCtripEbkInfo,
            args: [10000],
          })
        : await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: extractCtripHotelInfo,
          });
    const value = injection?.result;
    if (!value) throw new Error("页面未返回酒店信息");

    collector.data[HOTEL_INFO_KEY] = { type: "hotel_info", platform, value };
    collector.variables[HOTEL_INFO_KEY] = { platform, ...value };
    const { hotelName, hotelCode } = (value.hotelInfo || {}) as { hotelName?: string; hotelCode?: string };
    const isLogin = value.isLogin ?? false;
    emit(`已获取${PLATFORM_LABELS[platform]}酒店信息: ${hotelName || "-"}（${hotelCode || "-"}）${isLogin ? "（已登录）" : "（未登录）"}`);
    return { platform, isLogin };
  } catch (err) {
    emit(`获取酒店信息失败(${platform}): ${err instanceof Error ? err.message : String(err)}`);
    return { platform, isLogin: false };
  }
}

/**
 * config.needLogin 时，navigate 目标属于 config.platform 才校验：
 * 未登录被重定向到其他域名（如 passport 登录页）时 info 为 null，同样视为未登录。
 */
export function assertLoggedIn(
  config: { platform?: HotelPlatform; needLogin?: boolean },
  requestedUrl: string,
  info: HotelInfoResult,
): void {
  const { platform, needLogin } = config;
  if (!needLogin || !platform || detectPlatform(requestedUrl) !== platform) return;
  if (info?.platform === platform && info.isLogin) return;
  throw new NotLoggedInError(`${PLATFORM_LABELS[platform]}未登录，请先在浏览器中登录后再执行任务`);
}
