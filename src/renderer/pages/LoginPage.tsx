import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuthStore } from "@/stores/useAuthStore";

export function LoginPage() {
  const { login, busy, error } = useAuthStore();
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [smsMessage, setSmsMessage] = useState("");
  useEffect(() => {
    if (!countdown) return;
    const timer = window.setTimeout(
      () => setCountdown((value) => value - 1),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [countdown]);
  const sendCode = async () => {
    setSending(true);
    setSmsMessage("");
    try {
      const result = await window.authApi.sendSms(mobile.trim());
      if (result.ok) {
        setCountdown(60);
        setSmsMessage("验证码已发送");
      } else setSmsMessage(result.error);
    } catch (err) {
      setSmsMessage(String(err));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="flex min-h-full items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="mb-2 text-xs tracking-widest text-muted-foreground">
            CLAUDE AGENT · 门店工作台
          </p>
          <CardTitle className="text-2xl">登录客户端</CardTitle>
          <CardDescription>
            使用手机号验证码登录，开始管理门店抓取任务。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) void login(mobile.trim(), code.trim());
            }}
          >
            <div className="space-y-2">
              <label htmlFor="login-mobile" className="text-sm font-medium">
                手机号
              </label>
              <Input
                id="login-mobile"
                type="tel"
                autoComplete="tel"
                inputMode="numeric"
                placeholder="请输入 11 位手机号"
                pattern="1[0-9]{10}"
                maxLength={11}
                required
                value={mobile}
                disabled={busy || sending}
                onChange={(event) => setMobile(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="login-code" className="text-sm font-medium">
                验证码
              </label>
              <div className="flex gap-2">
                <Input
                  id="login-code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  placeholder="请输入 6 位验证码"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  disabled={busy}
                  onChange={(event) => setCode(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    busy ||
                    sending ||
                    countdown > 0 ||
                    !/^1\d{10}$/.test(mobile.trim())
                  }
                  onClick={() => void sendCode()}
                >
                  {sending
                    ? "发送中…"
                    : countdown
                      ? `${countdown}s 后重试`
                      : "获取验证码"}
                </Button>
              </div>
            </div>
            {smsMessage && (
              <p role="status" className="text-sm text-muted-foreground">
                {smsMessage}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy || sending}>
              {busy ? "登录中…" : "登录"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
