import { LogView } from "@/components/LogView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useCrawlStore } from "@/stores/useCrawlStore";

export function CrawlPage() {
  const connected = useCrawlStore((s) => s.connected);
  const port = useCrawlStore((s) => s.port);
  const configText = useCrawlStore((s) => s.configText);
  const logs = useCrawlStore((s) => s.logs);
  const starting = useCrawlStore((s) => s.starting);
  const reloading = useCrawlStore((s) => s.reloading);
  const setConfigText = useCrawlStore((s) => s.setConfigText);
  const start = useCrawlStore((s) => s.start);
  const reloadExtension = useCrawlStore((s) => s.reloadExtension);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Chrome 抓取</CardTitle>
              <CardDescription>
                扩展执行 workflow，结果保存为本地文件
              </CardDescription>
            </div>
            <Badge variant={connected ? "success" : "danger"}>
              {connected ? `已连接 :${port}` : "未连接"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="text-sm font-medium" htmlFor="crawlConfig">
            抓取配置 JSON
          </label>
          <Textarea
            id="crawlConfig"
            rows={12}
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void start()} disabled={starting}>
              {starting
                ? connected
                  ? "抓取中…"
                  : "启动 Edge 中…"
                : "开始抓取"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void reloadExtension()}
              disabled={reloading || !connected}
            >
              {reloading ? "重载中…" : "重载扩展"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>抓取日志</CardTitle>
        </CardHeader>
        <CardContent>
          <LogView lines={logs} />
        </CardContent>
      </Card>
    </div>
  );
}
