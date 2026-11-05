import { registerRequestLogsIpc } from "./requestLogs";
import { registerAutoLaunchIpc } from "../window/autoLaunch";
import { registerAuthIpc } from "./auth";
import { registerApiIpc } from "./api";
import { registerCrawlIpc } from "./crawl";
import { registerUpdateIpc } from "./update";

export { startCrawlBridge } from "./crawl";

export function registerIpcHandlers(): void {
  registerRequestLogsIpc();
  registerAuthIpc();
  registerApiIpc();
  registerAutoLaunchIpc();
  registerCrawlIpc();
  registerUpdateIpc();
}
