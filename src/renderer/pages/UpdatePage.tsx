import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useUpdaterStore } from "@/stores/useUpdaterStore";

export function UpdatePage() {
  const version = useUpdaterStore((s) => s.version);
  const packaged = useUpdaterStore((s) => s.packaged);
  const status = useUpdaterStore((s) => s.status);
  const canDownload = useUpdaterStore((s) => s.canDownload);
  const checking = useUpdaterStore((s) => s.checking);
  const check = useUpdaterStore((s) => s.check);
  const download = useUpdaterStore((s) => s.download);

  return (
    <Card>
      <CardHeader>
        <CardTitle>自动更新</CardTitle>
        <CardDescription>GitHub Releases · xuanwenjing/electron-claude-agent</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          当前版本 {version || "…"} ·{" "}
          {packaged ? "打包版（可检查更新）" : "开发版（请用安装包测试更新）"}
        </p>
        <p className="text-sm">{status}</p>
        <div className="flex gap-2">
          <Button onClick={() => void check()} disabled={!packaged || checking}>
            {checking ? "检查中…" : "检查更新"}
          </Button>
          <Button variant="secondary" onClick={() => void download()} disabled={!canDownload}>
            下载更新
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
