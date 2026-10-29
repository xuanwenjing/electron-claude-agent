/**
 * 对齐 wormhole background handleXhrResponse + chrome_parse{Meituan,Fliggy,Douyin}InjectInfo：
 * 美团 / 飞猪 / 抖音的酒店信息来自平台页面自己发出的接口，被动监听后缓存到 chrome.storage.local。
 */
import { HotelPlatform, type XhrCapturePayload } from "../types";
import { sleep } from "../util";

const STORAGE_KEY = "xhrHotelInfo";

export type XhrHotelInfo = {
  hotelInfo: Record<string, unknown> & { hotelName: string; hotelCode: string; userNick?: string };
  /** 账号下有多家门店 */
  isGroup?: boolean;
};

type CacheEntry = { value: XhrHotelInfo; savedAt: number };

type Parser = (res: any) => XhrHotelInfo | null;

const parseMeituan: Parser = (res) => {
  if (res?.data?.poiId && res?.data?.poiName) {
    return {
      hotelInfo: { ...(res.data.poiBasicVO || {}), hotelName: res.data.poiName, hotelCode: String(res.data.poiId) },
    };
  }
  const list = res?.data?.poiList;
  if (Array.isArray(list) && list[0]) {
    const first = list[0];
    return {
      isGroup: list.length > 1,
      hotelInfo: { ...first, hotelName: first.poiName, hotelCode: first.poiIdStr || String(first.poiId) },
    };
  }
  return null;
};

const parseFliggy: Parser = (res) => {
  const first = res?.success ? res?.data?.dataSource?.[0] : null;
  if (first) {
    return { hotelInfo: { ...first, hotelName: first.label, hotelCode: String(first.value) } };
  }
  const contact = res?.data?.bdBdContactInfo?.[0];
  if (contact) {
    return {
      hotelInfo: { ...contact, hotelName: contact.hotelName, hotelCode: String(contact.hotelId), userNick: res.data.userNick },
    };
  }
  if (res?.data?.hidCache && res?.data?.hnameCache) {
    return { hotelInfo: { hotelName: res.data.hnameCache, hotelCode: String(res.data.hidCache) } };
  }
  return null;
};

const parseDouyin: Parser = (res) => {
  const list = res?.status_code === 0 ? res?.data?.list : null;
  if (!Array.isArray(list) || !list.length) return null;
  const first = list[0];
  return {
    isGroup: list.length > 1,
    hotelInfo: { ...first, hotelName: first.poi_name, hotelCode: String(first.poi_id) },
  };
};

const XHR_SOURCES: Array<{ platform: HotelPlatform; apis: string[]; parse: Parser }> = [
  {
    platform: HotelPlatform.Meituan,
    apis: ["/v1/ebooking/common/pois", "v1/base/common/queryVpoiBaseInfo"],
    parse: parseMeituan,
  },
  {
    platform: HotelPlatform.Fliggy,
    apis: ["/ebooking/hotel/queryHotelList.do", "/ebooking/windowsGlobal.do"],
    parse: parseFliggy,
  },
  {
    platform: HotelPlatform.Douyin,
    apis: ["/life/account/v2/poi/relation/search"],
    parse: parseDouyin,
  },
];

function toJson(response: unknown): unknown {
  if (typeof response !== "string") return response;
  try {
    return JSON.parse(response);
  } catch {
    return null;
  }
}

async function readCache(): Promise<Partial<Record<HotelPlatform, CacheEntry>>> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] ?? {}) as Partial<Record<HotelPlatform, CacheEntry>>;
}

/** background 收到任意 XHR 都调用；命中平台酒店信息接口则解析并缓存 */
export async function captureHotelInfoFromXhr(data: XhrCapturePayload | undefined): Promise<void> {
  if (!data?.api) return;
  const source = XHR_SOURCES.find((s) => s.apis.some((api) => data.api.includes(api)));
  if (!source) return;
  const value = source.parse(toJson(data.response));
  if (!value) return;
  const cache = await readCache();
  cache[source.platform] = { value, savedAt: Date.now() };
  await chrome.storage.local.set({ [STORAGE_KEY]: cache });
}

export async function getCachedHotelInfo(platform: HotelPlatform): Promise<CacheEntry | null> {
  return (await readCache())[platform] ?? null;
}

/** 等待 since 之后捕获到的酒店信息；超时返回 null */
export async function waitFreshHotelInfo(
  platform: HotelPlatform,
  since: number,
  timeoutMs: number,
): Promise<CacheEntry | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entry = await getCachedHotelInfo(platform);
    if (entry && entry.savedAt >= since) return entry;
    await sleep(500);
  }
  return null;
}
