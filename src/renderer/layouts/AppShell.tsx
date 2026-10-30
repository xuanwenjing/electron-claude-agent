import { Bug, Database, Download } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useCrawlStore } from "@/stores/useCrawlStore";
import { type PanelId, useUiStore } from "@/stores/useUiStore";

const navItems: Array<{ id: PanelId; label: string; icon: typeof Bug }> = [
  { id: "crawl", label: "抓取", icon: Bug },
  { id: "update", label: "更新", icon: Download },
  { id: "notes", label: "笔记", icon: Database },
];

export function AppShell({ children }: { children: ReactNode }) {
  const currentPanel = useUiStore((s) => s.currentPanel);
  const setPanel = useUiStore((s) => s.setPanel);
  const connected = useCrawlStore((s) => s.connected);

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
        <div className="px-4 py-5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Electron
          </p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">Claude Agent</h1>
        </div>
        <Separator />
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {navItems.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant="ghost"
              className={cn(
                "justify-start gap-2",
                currentPanel === id && "bg-sidebar-accent text-accent-foreground",
              )}
              onClick={() => setPanel(id)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Button>
          ))}
        </nav>
        <div className="p-3">
          <Badge variant={connected ? "success" : "secondary"} className="w-full justify-center">
            扩展 {connected ? "已连接" : "未连接"}
          </Badge>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
