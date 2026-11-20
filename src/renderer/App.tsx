import { Button } from "@/components/ui/button";
import { MerchantConnectionsPage } from "@/pages/MerchantConnectionsPage";
import { ExtensionConnectionGuide } from "@/components/ExtensionConnectionGuide";
import { LoginPage } from "@/pages/LoginPage";
import { OutletPicker } from "@/components/OutletPicker";
import { useAuthStore } from "@/stores/useAuthStore";
import { useEffect } from "react";
import { AppShell } from "@/layouts/AppShell";
import { UpdatePage } from "@/pages/UpdatePage";
import { useCrawlStore } from "@/stores/useCrawlStore";
import { useUiStore } from "@/stores/useUiStore";
import { useUpdaterStore } from "@/stores/useUpdaterStore";

export function App() {
  const { user, outlet, ready, restoreError, restore, resetLogin, busy } =
    useAuthStore();
  const connected = useCrawlStore((s) => s.connected);
  const panel = useUiStore((s) => s.currentPanel);

  useEffect(() => {
    useAuthStore.getState().init();
    useUpdaterStore.getState().init();
  }, []);

  useEffect(() => {
    if (user) useCrawlStore.getState().init();
    useCrawlStore.getState().clearLogs();
  }, [user, outlet?.outlet_code]);

  if (!ready)
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        正在加载登录状态…
      </div>
    );
  if (restoreError)
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <section className="w-full max-w-md space-y-4 rounded-sm border bg-card p-6">
          <h1 className="text-xl font-semibold">暂时无法恢复登录</h1>
          <p role="alert" className="break-words text-sm text-destructive">
            {restoreError}
          </p>
          <p className="text-sm text-muted-foreground">
            已保留本地登录凭证。可以检查网络后重试，或清除凭证重新登录。
          </p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void restore()}>
              重试连接
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void resetLogin()}
            >
              重新登录
            </Button>
          </div>
        </section>
      </div>
    );
  if (!user) return <LoginPage />;
  if (!outlet)
    return user.outlets.length > 1 ? (
      <OutletPicker />
    ) : (
      <div className="flex min-h-full items-center justify-center p-6">
        <section className="w-full max-w-md space-y-4 rounded-sm border bg-card p-6">
          <p className="text-muted-foreground">
            当前账号没有可用门店，请联系管理员分配门店。
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void resetLogin()}
          >
            退出登录
          </Button>
        </section>
      </div>
    );
  if (!connected)
    return (
      <AppShell>
        <ExtensionConnectionGuide />
      </AppShell>
    );

  return (
    <AppShell>
      <div className={panel === "merchants" ? "contents" : "hidden"}>
        <MerchantConnectionsPage key={`${user.id}:${outlet?.outlet_code}`} />
      </div>
      <div className={panel === "update" ? "contents" : "hidden"}>
        <UpdatePage />
      </div>
    </AppShell>
  );
}
