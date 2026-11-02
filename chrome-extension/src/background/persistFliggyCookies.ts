/** 飞猪 EBK 会话 cookie（关浏览器即失效）改成一年后过期；装上扩展就会改，之后新写入的也会改 */

const PERSIST_SECONDS = 365 * 24 * 60 * 60;
/** 这些域上的 cookie 会带到 hotel.fliggy.com / 登录 iframe */
const COOKIE_DOMAINS = ["fliggy.com", "fliggy.net", "havanalogin.taobao.com"];

function cookieHost(cookie: chrome.cookies.Cookie): string {
  return cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
}

function isTargetCookie(cookie: chrome.cookies.Cookie): boolean {
  const host = cookieHost(cookie);
  return COOKIE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function cookieUrl(cookie: chrome.cookies.Cookie): string {
  return `${cookie.secure ? "https" : "http"}://${cookieHost(cookie)}${cookie.path}`;
}

async function persistSessionCookie(cookie: chrome.cookies.Cookie): Promise<void> {
  if (!cookie.session || !isTargetCookie(cookie)) return;
  const details: chrome.cookies.SetDetails = {
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: Date.now() / 1000 + PERSIST_SECONDS,
    storeId: cookie.storeId,
  };
  if (!cookie.hostOnly) details.domain = cookie.domain;
  if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
  try {
    await chrome.cookies.set(details);
  } catch (err) {
    console.warn("[crawl-ext] 延长飞猪 cookie 失败", cookie.name, cookie.domain, err);
  }
}

async function persistExisting(): Promise<void> {
  const lists = await Promise.all(COOKIE_DOMAINS.map((domain) => chrome.cookies.getAll({ domain })));
  await Promise.all(lists.flat().map(persistSessionCookie));
}

export function initPersistFliggyCookies(): void {
  chrome.cookies.onChanged.addListener(({ removed, cookie }) => {
    if (!removed) void persistSessionCookie(cookie);
  });
  void persistExisting();
}
