import { PLATFORM_LABELS } from "./platform";
import type { HotelPlatform } from "./types";

export type BoundOutlet = { code: string; name?: string; group: string };

/** 已绑定门店与页面抓到的门店不一致：重试不会换店，任务直接结束 */
export class OutletMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutletMismatchError";
  }
}

/**
 * 账号绑定了本次抓到的平台时，平台门店编号必须一致。
 * 没有该平台的绑定，或这次没有抓到门店编号，则不检查。
 */
export function assertBoundOutlet(
  bindings: BoundOutlet[] | undefined,
  captured: unknown,
): void {
  if (!captured || typeof captured !== "object") return;
  const info = captured as {
    platform?: unknown;
    hotelInfo?: { hotelCode?: unknown };
  };
  const platform = typeof info.platform === "string" ? info.platform : "";
  const actual =
    typeof info.hotelInfo?.hotelCode === "string"
      ? info.hotelInfo.hotelCode.trim()
      : "";
  if (!platform || !actual) return;
  const expected = (bindings ?? []).filter(
    (item) => item.group === platform && item.code,
  );
  if (!expected.length) return;
  if (expected.some((item) => item.code === actual)) return;
  const label = PLATFORM_LABELS[platform as HotelPlatform] ?? platform;
  throw new OutletMismatchError(
    `${label}当前门店 ${actual} 与账号绑定的门店 ${expected.map((item) => item.code).join("、")} 不一致`,
  );
}
