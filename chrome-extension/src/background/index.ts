import { getBridgeStatus, initBridge, reconnectBridge } from "./bridge";
import { onXhrResponse, type XhrCapturePayload } from "../workflow";

chrome.runtime.onInstalled.addListener(() => {
  void initBridge();
});
chrome.runtime.onStartup.addListener(() => {
  void initBridge();
});
void initBridge();

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
    onXhrResponse(message.data as XhrCapturePayload, sender?.tab?.id);
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
