import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  MERCHANT_PLATFORMS,
  type MerchantPlatformId,
} from "../../shared/merchant";
import { useAuthStore } from "@/stores/useAuthStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Selection = {
  taskId: string;
  platformId: MerchantPlatformId;
  stage: "collecting" | "ready" | "binding" | "error";
  candidate?: { hotelName: string; hotelCode: string };
  message?: string;
  error?: string;
};

export function MerchantConnectionsPage() {
  const outlet = useAuthStore((state) => state.outlet);
  const [jobs, setJobs] = useState<
    Partial<Record<MerchantPlatformId, Selection>>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const jobsRef = useRef(jobs);
  const running = useRef<MerchantPlatformId | null>(null);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const version = useRef(0);
  const writeJobs = (
    next: Partial<Record<MerchantPlatformId, Selection>>,
  ) => {
    jobsRef.current = next;
    setJobs(next);
  };
  const putJob = (job: Selection) =>
    writeJobs({ ...jobsRef.current, [job.platformId]: job });
  const clearJob = (platformId: MerchantPlatformId) => {
    const next = { ...jobsRef.current };
    delete next[platformId];
    writeJobs(next);
  };
  const discard = () => {
    version.current++;
    for (const task of Object.values(jobsRef.current)) {
      if (task?.stage === "collecting")
        void window.crawlApi.cancel(task.taskId).catch(() => {});
    }
    running.current = null;
    busyRef.current = false;
    writeJobs({});
  };
  useEffect(() => {
    alive.current = true;
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      if (
        state.user?.id === previous.user?.id &&
        state.outlet?.outlet_code === previous.outlet?.outlet_code
      )
        return;
      discard();
      setBusy(false);
      setError("");
      setNotice("");
    });
    const stopProgress = window.crawlApi.onProgress(({ taskId, message }) => {
      const task = Object.values(jobsRef.current).find(
        (item) => item?.taskId === taskId && item.stage === "collecting",
      );
      if (task) putJob({ ...task, message });
    });
    return () => {
      alive.current = false;
      discard();
      unsubscribe();
      stopProgress();
    };
  }, []);

  const run = async (action: (current: () => boolean) => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const generation = version.current;
    const current = () => alive.current && generation === version.current;
    try {
      await action(current);
    } catch (err) {
      if (!current()) return;
      const message =
        err instanceof z.ZodError
          ? "未获取到有效门店信息，请登录平台并选择门店后重试"
          : String((err as Error).message || err);
      setError(message);
      const platformId = running.current;
      const task = platformId ? jobsRef.current[platformId] : undefined;
      if (platformId && task)
        putJob({
          ...task,
          stage: task.stage === "binding" ? "ready" : "error",
          error: message,
        });
    } finally {
      if (current()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const refresh = async () => {
    const result = await window.authApi.refresh();
    if (!result.ok) throw new Error(result.error);
  };
  const openLogin = async (url: string) => {
    const result = await window.crawlApi.openUrl(url);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice("已在 Edge 打开该平台，登录并选择门店后点「重新获取」");
  };
  const collect = (platform: (typeof MERCHANT_PLATFORMS)[number]) =>
    run(async (current) => {
      const taskId = crypto.randomUUID();
      running.current = platform.platform;
      putJob({ taskId, platformId: platform.platform, stage: "collecting" });
      const result = await window.crawlApi.start(
        {
          platform: platform.platform,
          needLogin: true,
          maxRetry: 0,
          workflow: [
            { type: "navigate", url: platform.home, name: "获取商家门店信息" },
          ],
        },
        taskId,
      );
      if (!current()) return;
      if (!result.ok) throw new Error(result.error || "门店信息获取失败");
      const info = z
        .object({
          variables: z.object({
            _hotelInfo: z.object({
              platform: z.literal(platform.platform),
              isLogin: z.literal(true),
              hotelInfo: z.object({
                hotelName: z.string().trim().min(1),
                hotelCode: z.string().trim().min(1),
              }),
            }),
          }),
        })
        .parse(result.data).variables._hotelInfo;
      putJob({
        taskId,
        platformId: platform.platform,
        stage: "ready",
        candidate: info.hotelInfo,
      });
    });
  const confirm = (platformId: MerchantPlatformId) =>
    run(async (current) => {
      const task = jobsRef.current[platformId];
      const session = useAuthStore.getState();
      const target = session.outlet;
      if (!task?.candidate || task.stage !== "ready" || !target) return;
      running.current = platformId;
      if (
        target.external_outlets.some((item) => item.group === task.platformId)
      )
        throw new Error("该平台已绑定，请刷新状态");
      putJob({ ...task, stage: "binding", error: undefined });
      const result = await window.requestApi.post("/admin/outlets/bind", {
        outlet_code: target.outlet_code,
        outlet_name: target.outlet_name,
        platform: task.platformId,
        external_id: task.candidate.hotelCode,
        external_name: task.candidate.hotelName,
      });
      if (!current()) return;
      if (result.code !== 200)
        throw new Error(result.msg || result.message || "绑定失败");
      // Keep a successful binding visible even when the subsequent profile refresh fails.
      const binding = {
        group: task.platformId,
        code: task.candidate.hotelCode,
        name: task.candidate.hotelName,
      };
      useAuthStore.setState((state) => {
        const outlets = state.user!.outlets.map((item) =>
          item.outlet_code === target.outlet_code
            ? {
                ...item,
                external_outlets: [
                  ...item.external_outlets.filter(
                    (value) => value.group !== task.platformId,
                  ),
                  binding,
                ],
              }
            : item,
        );
        return {
          user: { ...state.user!, outlets },
          outlet: outlets.find(
            (item) => item.outlet_code === target.outlet_code,
          )!,
        };
      });
      clearJob(platformId);
      setNotice("绑定成功");
      try {
        await refresh();
      } catch {
        if (current()) setNotice("绑定成功，资料刷新失败，可稍后点击刷新状态");
      }
    });
  const cancel = (platformId: MerchantPlatformId) => {
    const task = jobsRef.current[platformId];
    if (task?.stage === "collecting") {
      version.current++;
      void window.crawlApi.cancel(task.taskId).catch(() => {});
      busyRef.current = false;
      setBusy(false);
      if (running.current === platformId) running.current = null;
    }
    clearJob(platformId);
    setError("");
  };
  if (!outlet) return null;
  const working = busy;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">商家连接</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            当前门店：{outlet.outlet_name}
            。获取平台门店信息后，请核对再确认绑定。
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async (current) => {
              running.current = null;
              await refresh();
              if (current()) setNotice("绑定状态已刷新");
            })
          }
        >
          刷新状态
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
        }}
      >
        {MERCHANT_PLATFORMS.map((platform) => {
          const bindings = outlet.external_outlets.filter(
            (item) => item.group === platform.platform,
          );
          const task = jobs[platform.platform];
          return (
            <Card key={platform.platform}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>{platform.name}</CardTitle>
                  <Badge variant={bindings.length ? "success" : "secondary"}>
                    {bindings.length ? "已绑定" : "未绑定"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {bindings.length ? (
                  bindings.map((binding) => (
                    <div
                      key={`${binding.code}:${binding.name}`}
                      className="space-y-1 text-sm"
                    >
                      <p className="font-medium">{binding.name}</p>
                      <p className="break-all text-muted-foreground">
                        门店编号：{binding.code}
                      </p>
                    </div>
                  ))
                ) : (
                  <>
                    {!task && (
                      <p className="text-sm text-muted-foreground">
                        打开{platform.name}
                        商家首页，读取当前登录账号的门店信息。
                      </p>
                    )}
                    {task?.stage === "collecting" && (
                      <div role="status" className="space-y-1 text-sm">
                        <p>正在获取门店信息…</p>
                        <p className="break-all text-muted-foreground">
                          {task.message || "正在打开平台首页"}
                        </p>
                      </div>
                    )}
                    {task?.error && (
                      <p role="alert" className="text-sm text-destructive">
                        {task.error}。请在 Edge
                        中登录对应平台并选择正确门店后重试。
                      </p>
                    )}
                    {task?.candidate && (
                      <div className="space-y-2 rounded-sm border bg-muted/40 p-3 text-sm">
                        <p className="font-medium">
                          请确认以下门店属于「{outlet.outlet_name}」
                        </p>
                        <p>门店名称：{task.candidate.hotelName}</p>
                        <p className="break-all">
                          门店编号：{task.candidate.hotelCode}
                        </p>
                        <p className="text-muted-foreground">
                          确认后将绑定到当前门店。
                        </p>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {task?.stage === "ready" ? (
                        <Button
                          disabled={busy}
                          onClick={() => void confirm(platform.platform)}
                        >
                          确认绑定
                        </Button>
                      ) : task?.stage === "binding" ? (
                        <Button disabled>正在绑定…</Button>
                      ) : (
                        task?.stage !== "collecting" && (
                          <>
                            {task?.stage === "error" && (
                              <Button
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                  void openLogin(platform.home)
                                }
                              >
                                去登录
                              </Button>
                            )}
                            <Button
                              disabled={busy || working}
                              onClick={() => void collect(platform)}
                            >
                              {task?.stage === "error"
                                ? "重新获取"
                                : "连接商家"}
                            </Button>
                          </>
                        )
                      )}
                      {task && task.stage !== "binding" && (
                        <Button
                          variant="outline"
                          onClick={() => cancel(platform.platform)}
                        >
                          取消
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
