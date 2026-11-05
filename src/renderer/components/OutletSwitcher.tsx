import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/useAuthStore";

type Action = { type: "switch"; code: string } | { type: "logout" };
export function OutletSwitcher() {
  const { user, outlet } = useAuthStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Action | null>(null);
  const [prompt, setPrompt] = useState("");
  const perform = async (action: Action, confirmed = false) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result =
        action.type === "switch"
          ? await window.authApi.switchOutlet(action.code, confirmed)
          : await window.authApi.logout(confirmed);
      if (result.ok) {
        useAuthStore.setState(result.session);
        setPending(null);
      } else if (result.confirmationRequired) {
        setPending(action);
        setPrompt(result.error);
      } else {
        setError(result.error);
        setPending(null);
      }
    } catch (err) {
      setError(String(err));
      setPending(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="space-y-2 border-y p-3">
        <p className="truncate text-sm" title={user?.name}>
          {user?.name || user?.mobile}
        </p>
        <label
          htmlFor="current-outlet"
          className="text-xs text-muted-foreground"
        >
          当前门店
        </label>
        <select
          id="current-outlet"
          className="w-full rounded-md border bg-background p-2 text-sm"
          value={outlet?.outlet_code ?? ""}
          disabled={busy || !!pending || !user?.outlets.length}
          onChange={(event) =>
            void perform({ type: "switch", code: event.target.value })
          }
        >
          {!user?.outlets.length && <option value="">暂无可用门店</option>}
          {user?.outlets.map((item) => (
            <option key={item.outlet_code} value={item.outlet_code}>
              {item.outlet_name}
            </option>
          ))}
        </select>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || !!pending}
          onClick={() => void perform({ type: "logout" })}
        >
          退出登录
        </Button>
      </div>
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="switch-title"
            aria-describedby="switch-description"
            className="w-full max-w-md space-y-4 rounded-lg border bg-background p-6 shadow-lg"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) setPending(null);
              if (event.key === "Tab") {
                const buttons =
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)",
                  );
                if (
                  buttons.length &&
                  ((event.shiftKey && document.activeElement === buttons[0]) ||
                    (!event.shiftKey &&
                      document.activeElement === buttons[buttons.length - 1]))
                ) {
                  event.preventDefault();
                  buttons[event.shiftKey ? buttons.length - 1 : 0].focus();
                }
              }
            }}
          >
            <h2 id="switch-title" className="text-lg font-semibold">
              {pending.type === "switch" ? "确认切换门店" : "确认退出登录"}
            </h2>
            <p
              id="switch-description"
              className="text-sm text-muted-foreground"
            >
              {prompt}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                autoFocus
                variant="outline"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                取消
              </Button>
              <Button
                disabled={busy}
                onClick={() => void perform(pending, true)}
              >
                {busy
                  ? "处理中…"
                  : pending.type === "switch"
                    ? "确认切换门店"
                    : "确认退出"}
              </Button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
