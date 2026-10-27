import { registerAgentIpc } from "./agent";
import { registerCrawlIpc } from "./crawl";
import { registerDbIpc } from "./db";
import { registerUpdateIpc } from "./update";

export { startCrawlBridge } from "./crawl";

export function registerIpcHandlers(): void {
  registerAgentIpc();
  registerCrawlIpc();
  registerDbIpc();
  registerUpdateIpc();
}
