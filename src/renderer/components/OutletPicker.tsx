import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/useAuthStore";

export function OutletPicker() {
  const user = useAuthStore((state) => state.user);
  const outlets = user?.outlets ?? [];
  const [code, setCode] = useState(outlets[0]?.outlet_code ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enter = async () => {
    if (busy || !code) return;
    setBusy(true);
    setError("");
    try {
      const result = await window.authApi.chooseOutlet(code);
      if (result.ok) useAuthStore.setState({ ...result.session, ready: true });
      else setError(result.error);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await window.authApi.logout(true);
      if (result.ok) useAuthStore.setState({ ...result.session, ready: true });
      else setError(result.error);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="outlet-picker-title"
        className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6 shadow-lg"
      >
        <div>
          <h1 id="outlet-picker-title" className="text-xl font-semibold">
            选择门店
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {user?.name || user?.mobile} 有 {outlets.length}{" "}
            家门店，请选择本次要进入的门店。进入后不能切换，只能退出登录。
          </p>
        </div>
        <div className="space-y-2">
          {outlets.map((item) => (
            <label
              key={item.outlet_code}
              className="flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary"
            >
              <input
                type="radio"
                name="outlet"
                value={item.outlet_code}
                checked={code === item.outlet_code}
                onChange={() => setCode(item.outlet_code)}
              />
              <span>{item.outlet_name}</span>
            </label>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void logout()}>
            退出登录
          </Button>
          <Button disabled={busy || !code} onClick={() => void enter()}>
            {busy ? "处理中…" : "进入"}
          </Button>
        </div>
      </section>
    </div>
  );
}
