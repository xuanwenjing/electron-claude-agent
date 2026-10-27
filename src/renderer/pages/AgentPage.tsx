import { LogView } from "@/components/LogView";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAgentStore } from "@/stores/useAgentStore";

export function AgentPage() {
  const prompt = useAgentStore((s) => s.prompt);
  const running = useAgentStore((s) => s.running);
  const stopping = useAgentStore((s) => s.stopping);
  const logs = useAgentStore((s) => s.logs);
  const setPrompt = useAgentStore((s) => s.setPrompt);
  const clearLogs = useAgentStore((s) => s.clearLogs);
  const run = useAgentStore((s) => s.run);
  const stop = useAgentStore((s) => s.stop);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Claude Agent</CardTitle>
          <CardDescription>
            点击运行一轮 query。已开启 Skill / Read / Write / Glob / Grep / run_python（工作区内）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="text-sm font-medium" htmlFor="prompt">
            Prompt
          </label>
          <Textarea
            id="prompt"
            rows={8}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={running}
          />
          <div className="flex gap-2">
            <Button onClick={() => void run()} disabled={running}>
              {running ? "运行中…" : "运行 query"}
            </Button>
            {running ? (
              <Button
                variant="destructive"
                onClick={() => void stop()}
                disabled={stopping}
              >
                {stopping ? "停止中…" : "停止"}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={clearLogs} disabled={running}>
              清空日志
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>运行日志</CardTitle>
        </CardHeader>
        <CardContent>
          <LogView lines={logs} className="h-[28rem]" />
        </CardContent>
      </Card>
    </div>
  );
}
