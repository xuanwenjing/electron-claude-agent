import { useEffect, useState } from "react";
import type { RequestLog } from "../../shared/requestLogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RequestLogConsole() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [query, setQuery] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const modifier = isMac
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (
        event.code === "KeyL" &&
        modifier &&
        event.altKey &&
        !event.shiftKey &&
        !event.repeat
      ) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    if (!open) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const result = await window.requestLogsApi.read();
        if (!active) return;
        if (!result.ok) {
          setError(result.error);
          setLogs([]);
          return;
        }
        setLogs(result.data);
        setError("");
      } catch {
        if (active) setError("读取日志失败，请重试");
      }
      if (active) timer = setTimeout(read, 2000);
    };
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, refresh]);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setLogs([]);
    setError("");
  };
  const clear = async () => {
    setBusy(true);
    try {
      const result = await window.requestLogsApi.clear();
      if (result.ok) {
        setLogs([]);
        setRefresh((v) => v + 1);
      } else {
        setError(result.error);
        setLogs([]);
      }
    } catch {
      setError("清空日志失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const filtered = logs
    .filter(
      (log) =>
        (!errorsOnly || log.state === "error") &&
        `${log.method} ${log.url} ${log.status ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .reverse();
  return (
    <>
      {open && (
        <section
          role="region"
          aria-labelledby="request-log-title"
          className="flex h-full w-[40vw] min-w-80 max-w-[560px] shrink-0 flex-col border-l bg-background p-4"
        >
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 id="request-log-title" className="text-lg font-semibold">
              接口日志控制台
            </h2>
            <Button variant="ghost" size="sm" disabled={busy} onClick={close}>
              关闭
            </Button>
          </div>
          {error && (
            <p role="alert" className="mb-3 text-sm text-red-600">
              {error}
            </p>
          )}
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              最近 50 条接口调用，每 2
              秒刷新；完整展示原始内容。重启客户端后清空。
            </p>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Input
                aria-label="筛选接口"
                placeholder="筛选地址、方法或状态码"
                className="min-w-40 flex-1"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={errorsOnly}
                  onChange={(event) => setErrorsOnly(event.target.checked)}
                />
                仅失败
              </label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRefresh((v) => v + 1)}
              >
                刷新
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void clear()}
              >
                清空
              </Button>
            </div>
            <div className="min-h-0 overflow-auto space-y-2">
              {!filtered.length && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  暂无匹配的接口日志，可以发送验证码或执行其他接口操作后查看。
                </p>
              )}
              {filtered.map((log) => (
                <details key={log.id} className="rounded border p-3 text-sm">
                  <summary className="cursor-pointer break-all">
                    <span
                      className={
                        log.state === "error"
                          ? "text-red-600"
                          : "text-muted-foreground"
                      }
                    >
                      {new Date(log.startedAt).toLocaleTimeString()} ·{" "}
                      {log.state === "pending"
                        ? "请求中"
                        : log.state === "error"
                          ? "失败"
                          : "完成"}{" "}
                      · {log.status ?? "—"} ·{" "}
                      {log.durationMs === undefined
                        ? "—"
                        : `${log.durationMs} ms`}
                    </span>
                    <span className="ml-2 font-mono">
                      {log.method} {log.url}
                    </span>
                  </summary>
                  <p className="mt-3 font-medium">请求参数</p>
                  <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                    {log.request}
                  </pre>
                  <p className="mt-3 font-medium">响应内容</p>
                  <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                    {log.response ?? "等待响应…"}
                  </pre>
                </details>
              ))}
            </div>
          </>
        </section>
      )}
    </>
  );
}
