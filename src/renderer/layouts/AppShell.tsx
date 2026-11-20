import { OutletSwitcher } from "@/components/OutletSwitcher";
import { Download, Store } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCrawlStore } from "@/stores/useCrawlStore";
import { type PanelId, useUiStore } from "@/stores/useUiStore";

const navItems: Array<{ id: PanelId; label: string; icon: typeof Store }> = [
  { id: "merchants", label: "商家连接", icon: Store },
  { id: "update", label: "更新", icon: Download },
];

export function AppShell({ children }: { children: ReactNode }) {
  const currentPanel = useUiStore((s) => s.currentPanel);
  const setPanel = useUiStore((s) => s.setPanel);
  const connected = useCrawlStore((s) => s.connected);

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-3 border-b px-4 py-4">
          <span className="grid h-8 w-8 place-items-center bg-primary text-xs font-semibold text-primary-foreground">
            店
          </span>
          <div>
            <p className="text-xs text-muted-foreground">门店工作台</p>
            <h1 className="text-base font-semibold tracking-tight">回评客户端</h1>
          </div>
        </div>
        <OutletSwitcher />
        <nav className="flex flex-1 flex-col gap-1 px-3 py-3">
          {navItems.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant="ghost"
              className={cn(
                "justify-start gap-2 rounded-sm",
                currentPanel === id && "bg-sidebar-accent text-foreground",
              )}
              onClick={() => setPanel(id)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Button>
          ))}
        </nav>
        <div className="flex items-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
          <span
            className={cn(
              "h-1.5 w-1.5",
              connected ? "bg-success" : "bg-border",
            )}
          />
          扩展 {connected ? "已连接" : "未连接"}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
