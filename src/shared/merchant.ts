/** 客户端、扩展任务和绑定接口共用的平台值。 */
export const HotelPlatform = {
  CtripEbk: "CtripEbk",
  CtripHotel: "CtripHotel",
  Meituan: "MeiTuan",
  Douyin: "DouYin",
  Fliggy: "Fliggy",
} as const;
export type HotelPlatform = (typeof HotelPlatform)[keyof typeof HotelPlatform];

export const PLATFORM_LABELS: Record<HotelPlatform, string> = {
  [HotelPlatform.CtripEbk]: "携程EBK",
  [HotelPlatform.CtripHotel]: "携程酒店",
  [HotelPlatform.Meituan]: "美团",
  [HotelPlatform.Douyin]: "抖音",
  [HotelPlatform.Fliggy]: "飞猪",
};

/** 仅在读取旧接口数据时兼容历史名称，其余链路统一使用上面的值。 */
export function normalizePlatform(value: string): string {
  switch (value.toLowerCase()) {
    case "ctrip":
    case "ctripebk":
      return HotelPlatform.CtripEbk;
    case "ctriphotel":
      return HotelPlatform.CtripHotel;
    case "meituan":
      return HotelPlatform.Meituan;
    case "fliggy":
      return HotelPlatform.Fliggy;
    case "douyin":
      return HotelPlatform.Douyin;
    default:
      return value;
  }
}

export const MERCHANT_PLATFORMS = [
  {
    name: "携程",
    platform: HotelPlatform.CtripEbk,
    home: "https://ebooking.ctrip.com/home/mainland?microJump=true",
  },
  {
    name: "美团",
    platform: HotelPlatform.Meituan,
    home: "https://me.meituan.com/ebooking/merchant/comment-manage-react#/home",
  },
  {
    name: "飞猪",
    platform: HotelPlatform.Fliggy,
    home: "https://hotel.fliggy.com/ebooking/hotelBaseInfoUv.htm",
  },
  {
    name: "抖音",
    platform: HotelPlatform.Douyin,
    home: "https://life.douyin.com/",
  },
] as const;
export type MerchantPlatformId =
  (typeof MERCHANT_PLATFORMS)[number]["platform"];
