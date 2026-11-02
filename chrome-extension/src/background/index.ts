import { getBridgeStatus, initBridge, reconnectBridge } from "./bridge";
import { initPersistFliggyCookies } from "./persistFliggyCookies";
import { captureHotelInfoFromXhr, isCrawlWindow, onXhrResponse, type XhrCapturePayload } from "../workflow";
import { CRAWL_OVERLAY_QUERY } from "../shared/constants";

chrome.runtime.onInstalled.addListener(() => {
  void initBridge();
});
chrome.runtime.onStartup.addListener(() => {
  void initBridge();
});
void initBridge();
initPersistFliggyCookies();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_BRIDGE_STATUS") {
    sendResponse(getBridgeStatus());
    return true;
  }
  if (message?.type === "RECONNECT_BRIDGE") {
    reconnectBridge();
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "XHR_RESPONSE") {
    const data = message.data as XhrCapturePayload | undefined;
    onXhrResponse(data, sender?.tab?.id);
    if (!data?.error) void captureHotelInfoFromXhr(data);
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === CRAWL_OVERLAY_QUERY) {
    void isCrawlWindow(sender.tab?.windowId)
      .catch(() => false)
      .then((show) => sendResponse({ show }));
    return true;
  }
  return false;
});
