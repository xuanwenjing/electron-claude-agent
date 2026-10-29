/**
 * 对齐 wormhole：同一平台当天自动登录失败达上限后不再尝试，避免频繁失败触发平台风控。
 * 携程 EBK 不限流。
 */
import { HotelPlatform } from "../types";

const STORAGE_KEY = "autoLoginFailedToday";
export const AUTO_LOGIN_MAX_FAIL_COUNT = 3;

type FailRecord = { date: string; count: number };

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function readRecords(): Promise<Partial<Record<HotelPlatform, FailRecord>>> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] ?? {}) as Partial<Record<HotelPlatform, FailRecord>>;
}

export async function isAutoLoginDisabledToday(platform: HotelPlatform): Promise<boolean> {
  if (platform === HotelPlatform.CtripEbk) return false;
  const record = (await readRecords())[platform];
  return record?.date === today() && record.count >= AUTO_LOGIN_MAX_FAIL_COUNT;
}

export async function recordAutoLoginResult(platform: HotelPlatform, success: boolean): Promise<number> {
  const records = await readRecords();
  if (success) {
    delete records[platform];
    await chrome.storage.local.set({ [STORAGE_KEY]: records });
    return 0;
  }
  const prev = records[platform];
  const count = prev?.date === today() ? prev.count + 1 : 1;
  records[platform] = { date: today(), count };
  await chrome.storage.local.set({ [STORAGE_KEY]: records });
  return count;
}
