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

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function CrawlPage() {
  const connected = useCrawlStore((s) => s.connected);
  const port = useCrawlStore((s) => s.port);
  const configText = useCrawlStore((s) => s.configText);
  const results = useCrawlStore((s) => s.results);
  const logs = useCrawlStore((s) => s.logs);
  const starting = useCrawlStore((s) => s.starting);
  const reloading = useCrawlStore((s) => s.reloading);
  const setConfigText = useCrawlStore((s) => s.setConfigText);
  const start = useCrawlStore((s) => s.start);
  const reloadExtension = useCrawlStore((s) => s.reloadExtension);
  const refreshResults = useCrawlStore((s) => s.refreshResults);
  const openXiaohongshu = useCrawlStore((s) => s.openXiaohongshu);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Chrome 抓取</CardTitle>
              <CardDescription>
                扩展执行 workflow → 本客户端入库。加载{" "}
                <code className="rounded bg-muted px-1">chrome-extension/dist/</code>
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
            <Button onClick={() => void start()} disabled={starting || !connected}>
              {starting ? "下发中…" : "开始抓取"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void reloadExtension()}
              disabled={reloading || !connected}
            >
              {reloading ? "重载中…" : "重载扩展"}
            </Button>
            <Button variant="outline" onClick={() => void refreshResults()}>
              刷新结果
            </Button>
            <Button variant="outline" onClick={() => void openXiaohongshu()}>
              用 Chrome 打开小红书
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

      <Card>
        <CardHeader>
          <CardTitle>抓取结果</CardTitle>
          <CardDescription>写入 app.db 的 crawl_results 表</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无抓取结果</p>
          ) : (
            results.map((row) => (
              <div
                key={row.id}
                className="rounded-md border border-border bg-muted/30 p-3 text-sm"
              >
                <div className="mb-1 flex items-center gap-2">
                  <Badge variant={row.ok ? "success" : "danger"}>#{row.id}</Badge>
                  <span className="text-muted-foreground">
                    {row.ok ? "成功" : "失败"} · {new Date(row.createdAt).toLocaleString()} ·{" "}
                    {formatBytes(row.payloadBytes)}
                  </span>
                </div>
                <p className="mb-2 font-mono text-xs text-muted-foreground">{row.taskId}</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">
                  {row.ok ? row.payload : row.error || row.payload}
                </pre>
                {row.truncated ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    仅显示前 2000 字，完整 payload {formatBytes(row.payloadBytes)}（未灌入页面）
                  </p>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
