/**
 * 平台页面自带的签名 / 请求能力，都在宿主页 MAIN world 调用页面全局对象。
 * - 美团：window.H5guard.sign → 请求头 mtgsig
 * - 飞猪：window.mtopRequest → 直接发 mtop 请求
 */

/** 页面全局对象可能晚于 load 才挂上，最多等这么久 */
const PAGE_GLOBAL_WAIT_MS = 5000;

type PageCallResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function callPageGlobal<T>(
  tabId: number,
  globalName: string,
  args: unknown,
): Promise<PageCallResult<T>> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (name: string, input: unknown, waitMs: number) => {
      const w = window as unknown as Record<string, unknown>;
      const resolve = (): ((arg: unknown) => unknown) | null => {
        let owner: unknown = undefined;
        let target: unknown = w;
        for (const key of name.split(".")) {
          owner = target;
          target = (target as Record<string, unknown> | undefined)?.[key];
        }
        return typeof target === "function" ? (target as (arg: unknown) => unknown).bind(owner) : null;
      };
      const deadline = Date.now() + waitMs;
      let fn = resolve();
      while (!fn && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        fn = resolve();
      }
      if (!fn) return { ok: false as const, error: `页面没有 window.${name}` };
      try {
        const res = await fn(input);
        if (!res) return { ok: false as const, error: `window.${name} 返回空: ${String(res)}` };
        return { ok: true as const, data: JSON.parse(JSON.stringify(res)) };
      } catch (error) {
        return {
          ok: false as const,
          error: `window.${name} 异常: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
    args: [globalName, args, PAGE_GLOBAL_WAIT_MS],
  });
  return (injection?.result as PageCallResult<T> | undefined) ?? { ok: false, error: "页面脚本未返回结果" };
}

/** 美团：对最终要发出的 url / body 签名，返回要合并进请求头的签名头（含 mtgsig） */
export async function signMtgsig(
  tabId: number,
  req: { url: string; method: string; body: string | null },
): Promise<Record<string, string>> {
  const res = await callPageGlobal<{ headers?: Record<string, string> }>(tabId, "H5guard.sign", {
    url: req.url,
    method: req.method,
    ...(req.body != null ? { data: req.body } : {}),
  });
  if (!res.ok) throw new Error(`美团 mtgsig 签名失败（需先 navigate 到美团 EBK 页面）: ${res.error}`);
  const headers = res.data.headers;
  if (!headers?.mtgsig) throw new Error(`美团 mtgsig 签名结果缺少 headers.mtgsig: ${JSON.stringify(res.data)}`);
  return headers;
}

/** 飞猪：用页面的 mtopRequest 发请求，返回其结果 */
export async function requestMtop(tabId: number, args: Record<string, unknown>): Promise<unknown> {
  const res = await callPageGlobal<unknown>(tabId, "mtopRequest", args);
  if (!res.ok) throw new Error(`飞猪 mtop 请求失败（需先 navigate 到飞猪 EBK 页面）: ${res.error}`);
  return res.data;
}
