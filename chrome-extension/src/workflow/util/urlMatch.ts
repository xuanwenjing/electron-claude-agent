/**
 * URL 规则：`路径正则[?k=v&k2=*]`，逗号分隔多条，任一命中即匹配。
 * - 路径部分是不带锚点的正则，只和 URL 的 ? 之前比较；? 和 , 已用作分隔符，正则里不能出现（可选字符写成 (s|)）
 * - 参数条件全部满足才命中：k=v 值相等；k=* 或只写 k 表示带了该参数即可
 * - 规则不合法直接抛错（不会退化成匹配全部）
 */

type UrlMatcher = (url: string) => boolean;

const cache = new Map<string, UrlMatcher>();

/** URL 的 query 参数（忽略 #hash） */
export function parseQuery(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  new URLSearchParams(url.split("#")[0].split("?")[1] || "").forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function compileOne(rule: string): UrlMatcher {
  const [path, query = ""] = rule.split("?");
  let re: RegExp;
  try {
    re = new RegExp(path);
  } catch (err) {
    throw new Error(`URL 规则不合法: ${rule}（${err instanceof Error ? err.message : String(err)}）`);
  }
  const conditions: [string, string][] = [];
  new URLSearchParams(query).forEach((value, key) => conditions.push([key, value]));
  return (url) => {
    if (!re.test(url.split("?")[0])) return false;
    if (!conditions.length) return true;
    const actual = parseQuery(url);
    return conditions.every(
      ([key, value]) => key in actual && (value === "" || value === "*" || actual[key] === value),
    );
  };
}

/** 编译并缓存；规则不合法抛错，步骤开始前校验配置也用它 */
export function compileUrlRule(rule: string): UrlMatcher {
  let matcher = cache.get(rule);
  if (!matcher) {
    const parts = rule
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(compileOne);
    if (!parts.length) throw new Error(`URL 规则为空: ${JSON.stringify(rule)}`);
    matcher = (url) => parts.some((match) => match(url));
    cache.set(rule, matcher);
  }
  return matcher;
}

export function urlMatch(url: string | null | undefined, rule: string): boolean {
  return !!url && compileUrlRule(rule)(url);
}
