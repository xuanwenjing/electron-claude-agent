import { registerApiIpc } from "./api";
import { registerCrawlIpc } from "./crawl";
import { registerDbIpc } from "./db";
import { registerUpdateIpc } from "./update";

export { startCrawlBridge } from "./crawl";

export function registerIpcHandlers(): void {
  registerApiIpc();
  registerCrawlIpc();
  registerDbIpc();
  registerUpdateIpc();
}
