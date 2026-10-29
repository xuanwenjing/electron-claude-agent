/** 扩展内共享常量 */

/** 相对扩展根目录（dist），供 chrome.scripting.executeScript */
export const CONTENT_SCRIPT_FILE = "content/index.js";
export const PAGE_FETCH_PROXY_FILE = "page/fetchProxy.js";

/** content ↔ MAIN 世界 postMessage 约定 */
export const PAGE_FETCH_SOURCE = "crawl-page-fetch-proxy";
export const XHR_RESPONSE_TYPE = "CRAWL_XHR_RESPONSE";
export const XHR_RESPONSE_MSG = "XHR_RESPONSE";

/** 采集窗口蒙层：content → background */
export const CRAWL_OVERLAY_QUERY = "CRAWL_OVERLAY_QUERY";
/** 蒙层宿主元素 id；CDP 真实点击前需临时隐藏，否则会点在蒙层上 */
export const CRAWL_OVERLAY_HOST_ID = "__crawl_window_overlay__";
