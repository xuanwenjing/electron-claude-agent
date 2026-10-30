/** 浏览器「不允许在该网站使用扩展」时，chrome.tabs / scripting 报的错误 */
const BLOCKED_MESSAGE = "Blocked";

export class SiteBlockedError extends Error {
  constructor(public readonly origin: string) {
    super(`浏览器已设置不允许在 ${origin} 使用扩展`);
    this.name = "SiteBlockedError";
  }
}

function httpOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const { origin, protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? origin : null;
  } catch {
    return null;
  }
}

async function isOriginAllowed(origin: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [`${origin}/*`] });
}

/** 打开页面前检查：站点被禁用扩展则抛 SiteBlockedError */
export async function assertSiteAllowed(url: string): Promise<void> {
  const origin = httpOrigin(url);
  if (origin && !(await isOriginAllowed(origin))) throw new SiteBlockedError(origin);
}

/** 步骤失败时兜底：失败原因是站点被禁用扩展则返回该站点 origin，否则 null */
export async function blockedOriginOf(err: unknown, tabId: number | null): Promise<string | null> {
  if (err instanceof SiteBlockedError) return err.origin;
  if (tabId == null) return null;
  let origin: string | null;
  try {
    const tab = await chrome.tabs.get(tabId);
    origin = httpOrigin(tab.pendingUrl || tab.url);
  } catch {
    return null;
  }
  if (!origin) return null;
  if (err instanceof Error && err.message === BLOCKED_MESSAGE) return origin;
  return (await isOriginAllowed(origin)) ? null : origin;
}
