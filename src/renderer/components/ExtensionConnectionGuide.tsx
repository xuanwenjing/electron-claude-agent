import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCrawlStore } from "@/stores/useCrawlStore";

export function ExtensionConnectionGuide() {
  const extensionDir = useCrawlStore((state) => state.extensionDir);
  const [error, setError] = useState("");

  const openDirectory = async () => {
    setError("");
    try {
      const result = await window.crawlApi.revealExtensionDir();
      if (!result.ok) setError(result.error);
    } catch {
      setError("无法打开扩展目录，请复制路径后手动打开。");
    }
  };
  const copyPath = async () => {
    setError("");
    try {
      await navigator.clipboard.writeText(extensionDir);
    } catch {
      setError("复制失败，请手动复制上方路径。");
    }
  };

  return (
    <section
      aria-label="扩展连接指引"
      className="space-y-3 rounded-sm border bg-card p-6 text-sm"
    >
      <h2 className="font-medium">扩展未连接</h2>
      <p className="text-muted-foreground">
        请先确认 Microsoft Edge 浏览器已打开。若尚未打开，请启动
        Edge；已安装扩展时，请确认扩展已启用，并等待自动连接。
      </p>
      <p className="text-muted-foreground">
        若尚未安装扩展，在 Edge 打开{" "}
        <code className="rounded bg-muted px-1">edge://extensions</code>
        ，开启「开发人员模式」，点「加载解压缩的扩展」，选择以下目录：
      </p>
      <p className="break-all font-mono text-xs">
        {extensionDir || "正在获取扩展目录…"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!extensionDir}
          onClick={() => void openDirectory()}
        >
          打开扩展目录
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!extensionDir}
          onClick={() => void copyPath()}
        >
          复制路径
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
