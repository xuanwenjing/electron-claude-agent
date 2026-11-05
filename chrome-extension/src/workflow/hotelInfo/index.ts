/**
 * 对齐 wormhole content-common/matches/dataInjector：
 * navigate 结束后按平台取门店信息写入 collector，同时给出登录态供 needLogin 校验：
 * - 携程 EBK / 携程酒店：在页面 MAIN world 提取
 * - 美团 / 飞猪 / 抖音：取页面接口被动捕获的数据（见 xhrHotelInfo）
 */
import { PLATFORM_LABELS, detectPlatform, isLoginUrl, isOnLoginPage, loginPlatformOf } from "../platform";
import { HotelPlatform, type Collector, type EmitFn } from "../types";
import { setVariable } from "../variables";
import { waitFreshHotelInfo } from "./xhrHotelInfo";

export { captureHotelInfoFromXhr, getCachedHotelInfo } from "./xhrHotelInfo";

export const HOTEL_INFO_KEY = "_hotelInfo";

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
  hotelInfo.hotelName = ebkHotelInfo.hotelCName || ""; // 取中文门店名
  hotelInfo.hotelNameEn = ebkHotelInfo.hotelEName || ""; // 取中文门店名
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

/** 登录校验失败：重试无意义，runWorkflow 直接结束任务 */
export class NotLoggedInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotLoggedInError";
  }
}

/** 步骤失败时兜底：任务标签停在平台登录页（中途登录态失效）则返回未登录错误，否则 null */
export async function loginPageError(tabId: number | null): Promise<NotLoggedInError | null> {
  if (tabId == null) return null;
  let url: string | undefined;
  try {
    url = (await chrome.tabs.get(tabId)).url;
  } catch {
    return null;
  }
  const platform = loginPlatformOf(url);
  if (!platform) return null;
  return new NotLoggedInError(`${PLATFORM_LABELS[platform]}未登录（页面已跳转到登录页），请先在浏览器中登录后再执行任务`);
}

export type HotelInfoResult = { platform: HotelPlatform; isLogin: boolean } | null;

const XHR_HOTEL_INFO_WAIT_MS = 10000;

function saveHotelInfo(
  collector: Collector,
  platform: HotelPlatform,
  value: { hotelInfo?: { hotelName?: string; hotelCode?: string }; isLogin?: boolean } & Record<string, unknown>,
  emit: EmitFn,
): void {
  setVariable(collector, HOTEL_INFO_KEY, { platform, ...value });
  const { hotelName, hotelCode } = value.hotelInfo || {};
  emit(
    `已获取${PLATFORM_LABELS[platform]}门店信息: ${hotelName || "-"}（${hotelCode || "-"}）${value.isLogin ? "（已登录）" : "（未登录）"}`,
  );
}

/**
 * 美团 / 飞猪 / 抖音：落在登录页即未登录；否则等本次导航后页面接口捕获的门店信息，
 * 等待期间页面跳到登录页（单页应用加载完后才发现未登录）同样视为未登录；超时明确记录未获取到，不使用旧缓存。
 */
async function collectXhrHotelInfo(
  tabId: number,
  tabUrl: string | undefined,
  platform: HotelPlatform,
  collector: Collector,
  emit: EmitFn,
  navigatedAt: number,
): Promise<HotelInfoResult> {
  const notLoggedIn = (): HotelInfoResult => {
    emit(`${PLATFORM_LABELS[platform]}未登录`);
    return { platform, isLogin: false };
  };
  if (isLoginUrl(tabUrl, platform)) return notLoggedIn();
  const { entry, stopped } = await waitFreshHotelInfo(
    platform,
    navigatedAt,
    XHR_HOTEL_INFO_WAIT_MS,
    () => isOnLoginPage(tabId, platform).catch(() => false),
  );
  if (stopped) return notLoggedIn();
  if (entry) {
    saveHotelInfo(collector, platform, { ...entry.value, isLogin: true }, emit);
  } else {
    emit(`未捕获到${PLATFORM_LABELS[platform]}门店信息（页面未请求门店信息接口）`);
  }
  return { platform, isLogin: true };
}

/**
 * 按标签当前 URL（含重定向后）判断平台，提取门店信息写入
 * collector.variables._hotelInfo。
 * 提取失败只记日志，不中断 workflow；不在已知平台页时返回 null。
 * navigatedAt：本次 navigate 开始时间，用于区分接口捕获数据是否为本次页面产生。
 */
export async function collectHotelInfo(
  tabId: number,
  collector: Collector,
  emit: EmitFn,
  navigatedAt = Date.now(),
): Promise<HotelInfoResult> {
  setVariable(collector, HOTEL_INFO_KEY, undefined);
  const tab = await chrome.tabs.get(tabId);
  const platform = detectPlatform(tab.url);
  if (!platform) return null;
  if (platform !== HotelPlatform.CtripEbk && platform !== HotelPlatform.CtripHotel) {
    return collectXhrHotelInfo(tabId, tab.url, platform, collector, emit, navigatedAt);
  }

  try {
    const [injection] =
      platform === HotelPlatform.CtripEbk
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
    if (!value) throw new Error("页面未返回门店信息");

    saveHotelInfo(collector, platform, value, emit);
    return { platform, isLogin: value.isLogin ?? false };
  } catch (err) {
    emit(`获取门店信息失败(${platform}): ${err instanceof Error ? err.message : String(err)}`);
    return { platform, isLogin: false };
  }
}

type LoginConfig = { platform?: HotelPlatform; needLogin?: boolean };

/**
 * config.needLogin 时，navigate 目标属于 config.platform 才校验：
 * 未登录被重定向到其他域名（如 passport 登录页）时 info 为 null，同样视为未登录。
 * 返回缺登录的平台；无需登录或已登录返回 null。
 */
export function getMissingLoginPlatform(
  config: LoginConfig,
  requestedUrl: string,
  info: HotelInfoResult,
): HotelPlatform | null {
  const { platform, needLogin } = config;
  if (needLogin === false || !platform || detectPlatform(requestedUrl) !== platform) return null;
  if (info?.platform === platform && info.isLogin) return null;
  return platform;
}

export function assertLoggedIn(config: LoginConfig, requestedUrl: string, info: HotelInfoResult, reason?: string): void {
  const platform = getMissingLoginPlatform(config, requestedUrl, info);
  if (!platform) return;
  const detail = reason ? `（自动登录失败：${reason}）` : "";
  throw new NotLoggedInError(`${PLATFORM_LABELS[platform]}未登录${detail}，请先在浏览器中登录后再执行任务`);
}
