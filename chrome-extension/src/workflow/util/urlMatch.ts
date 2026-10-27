/** 对齐 wormhole common_urlMatch：支持逗号多规则、* 通配 */

export function urlMatch(url: string | undefined | null, reg: string | undefined | null): boolean {
  if (!url) return false;
  if (!reg || String(reg).trim() === "") return true;
  try {
    const filters = String(reg)
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    return filters.some((filter) => {
      const regex = new RegExp(filter.split("?")[0].replace(/\*/g, ".*"));
      return regex.test(url);
    });
  } catch {
    return true;
  }
}
