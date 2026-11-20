import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/useAuthStore";

export function OutletSwitcher() {
  const { user, outlet } = useAuthStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [prompt, setPrompt] = useState("");
  const logout = async (confirmed = false) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await window.authApi.logout(confirmed);
      if (result.ok) {
        useAuthStore.setState({ ...result.session, ready: true });
        setPending(false);
      } else if (result.confirmationRequired) {
        setPending(true);
        setPrompt(result.error);
      } else {
        setError(result.error);
        setPending(false);
      }
    } catch (err) {
      setError(String(err));
      setPending(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="space-y-1.5 border-b px-4 py-3">
        <p className="truncate text-sm" title={user?.name}>
          {user?.name || user?.mobile}
        </p>
        <p className="text-xs text-muted-foreground">当前门店</p>
        <p className="truncate text-sm" title={outlet?.outlet_name}>
          {outlet?.outlet_name || "未选择"}
        </p>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || pending}
          onClick={() => void logout()}
        >
          退出登录
        </Button>
      </div>
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="logout-title"
            aria-describedby="logout-description"
            className="w-full max-w-md space-y-4 rounded-sm border bg-card p-6"
          >
            <h2 id="logout-title" className="text-lg font-semibold">
              确认退出登录
            </h2>
            <p id="logout-description" className="text-sm text-muted-foreground">
              {prompt}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                autoFocus
                variant="outline"
                disabled={busy}
                onClick={() => setPending(false)}
              >
                取消
              </Button>
              <Button disabled={busy} onClick={() => void logout(true)}>
                {busy ? "处理中…" : "确认退出"}
              </Button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
