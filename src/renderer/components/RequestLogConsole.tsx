import { useEffect, useState } from "react";
import type { ConsoleLog, RequestLog } from "../../shared/requestLogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function RequestLogConsole() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"api" | "console">("api");
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([]);
  const [query, setQuery] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [copiedId, setCopiedId] = useState<number | null>(null);

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
        const [result, consoleResult] = await Promise.all([
          window.requestLogsApi.read(),
          window.requestLogsApi.readConsole(),
        ]);
        if (!active) return;
        if (!result.ok || !consoleResult.ok) {
          setError(
            !result.ok
              ? result.error
              : !consoleResult.ok
                ? consoleResult.error
                : "读取日志失败",
          );
          if (!result.ok) setLogs([]);
          if (!consoleResult.ok) setConsoleLogs([]);
          return;
        }
        setLogs(result.data);
        setConsoleLogs(consoleResult.data);
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
    setConsoleLogs([]);
    setError("");
  };
  const copyCurl = async (log: RequestLog) => {
    if (!log.curl) return;
    try {
      await navigator.clipboard.writeText(log.curl);
    } catch {
      const area = document.createElement("textarea");
      area.value = log.curl;
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      if (!ok) {
        setError("复制失败，请重试");
        return;
      }
    }
    setCopiedId(log.id);
    setError("");
    window.setTimeout(() => {
      setCopiedId((current) => (current === log.id ? null : current));
    }, 2000);
  };
  const clear = async () => {
    setBusy(true);
    try {
      const result =
        tab === "console"
          ? await window.requestLogsApi.clearConsole()
          : await window.requestLogsApi.clear();
      if (result.ok) {
        if (tab === "console") setConsoleLogs([]);
        else setLogs([]);
        setRefresh((v) => v + 1);
      } else {
        setError(result.error);
        if (tab === "console") setConsoleLogs([]);
        else setLogs([]);
      }
    } catch {
      setError("清空日志失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const needle = query.toLowerCase();
  const filtered = logs
    .filter(
      (log) =>
        (!errorsOnly || log.state === "error") &&
        `${log.method} ${log.url} ${log.status ?? ""}`.toLowerCase().includes(needle),
    )
    .reverse();
  const filteredConsole = consoleLogs
    .filter(
      (log) =>
        (!errorsOnly || log.level === "error" || log.level === "warn") &&
        `${log.level} ${log.message}`.toLowerCase().includes(needle),
    )
    .reverse();
  return (
    <>
      {open && (
        <section
          role="region"
          aria-labelledby="request-log-title"
          className="flex h-full w-[40vw] min-w-80 max-w-[560px] shrink-0 flex-col border-l bg-card p-4"
        >
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 id="request-log-title" className="text-lg font-semibold">
              日志控制台
            </h2>
            <Button variant="ghost" size="sm" disabled={busy} onClick={close}>
              关闭
            </Button>
          </div>
          <div className="mb-3 flex border-b">
            {(
              [
                ["api", "接口"],
                ["console", "控制台"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={cn(
                  "-mb-px flex-1 border-b px-3 py-2 text-sm",
                  tab === id
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground",
                )}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              {tab === "api"
                ? "最近 50 条接口调用，每 2 秒刷新；完整展示原始内容。重启客户端后清空。"
                : "主进程 console 输出，最近 200 条，每 2 秒刷新。终端里仍会打印。重启客户端后清空。"}
            </p>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Input
                aria-label={tab === "api" ? "筛选接口" : "筛选控制台"}
                placeholder={tab === "api" ? "筛选地址、方法或状态码" : "筛选级别或内容"}
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
                {tab === "api" ? "仅失败" : "仅错误"}
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
              {tab === "console" && !filteredConsole.length && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  暂无控制台日志。任务调度和推送连接的输出会显示在这里。
                </p>
              )}
              {tab === "console" &&
                filteredConsole.map((log) => (
                  <pre
                    key={log.id}
                    className={cn(
                      "whitespace-pre-wrap break-all rounded-sm border bg-background p-3 text-xs",
                      log.level === "error"
                        ? "text-destructive"
                        : log.level === "warn"
                          ? "text-warning"
                          : "text-foreground",
                    )}
                  >
                    <span className="text-muted-foreground">
                      {new Date(log.at).toLocaleTimeString()} · {log.level}
                    </span>
                    {"\n"}
                    {log.message}
                  </pre>
                ))}
              {tab === "api" && !filtered.length && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  暂无匹配的接口日志，可以发送验证码或执行其他接口操作后查看。
                </p>
              )}
              {tab === "api" &&
                filtered.map((log) => (
                <details key={log.id} className="rounded-sm border bg-background p-3 text-sm">
                  <summary className="flex cursor-pointer items-start gap-2 break-all">
                    <span className="min-w-0 flex-1">
                      <span
                        className={
                          log.state === "error"
                            ? "text-destructive"
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
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void copyCurl(log);
                      }}
                    >
                      {copiedId === log.id ? "已复制" : "复制"}
                    </Button>
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
