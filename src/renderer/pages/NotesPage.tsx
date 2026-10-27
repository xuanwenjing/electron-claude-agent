import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAgentStore } from "@/stores/useAgentStore";
import { useNotesStore } from "@/stores/useNotesStore";

export function NotesPage() {
  const path = useNotesStore((s) => s.path);
  const count = useNotesStore((s) => s.count);
  const notes = useNotesStore((s) => s.notes);
  const draft = useNotesStore((s) => s.draft);
  const busy = useNotesStore((s) => s.busy);
  const error = useNotesStore((s) => s.error);
  const setDraft = useNotesStore((s) => s.setDraft);
  const refresh = useNotesStore((s) => s.refresh);
  const add = useNotesStore((s) => s.add);
  const remove = useNotesStore((s) => s.remove);
  const clear = useNotesStore((s) => s.clear);
  const appendLog = useAgentStore((s) => s.appendLog);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>本地笔记</CardTitle>
        <CardDescription>better-sqlite3 + Drizzle · userData/app.db</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {error ? `数据库错误: ${error}` : `路径: ${path || "…"} · 共 ${count} 条`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Input
            className="min-w-[220px] flex-1"
            placeholder="写一条笔记"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add().then((err) => {
                  if (err) appendLog("error", err);
                  else appendLog("log", "已写入笔记");
                });
              }
            }}
          />
          <Button
            disabled={busy}
            onClick={() =>
              void add().then((err) => {
                if (err) appendLog("error", err);
                else appendLog("log", "已写入笔记");
              })
            }
          >
            添加
          </Button>
          <Button variant="secondary" onClick={() => void refresh()}>
            刷新
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void clear().then((err) => {
                if (err) appendLog("error", err);
                else appendLog("log", "已清空笔记");
              })
            }
          >
            清空全部
          </Button>
        </div>
        <ul className="space-y-2">
          {notes.length === 0 ? (
            <li className="text-sm text-muted-foreground">暂无笔记，添加一条试试</li>
          ) : (
            notes.map((note) => (
              <li
                key={note.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
              >
                <div>
                  <p className="text-sm">{note.content}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    #{note.id} · {new Date(note.createdAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    void remove(note.id).then((err) => {
                      if (err) appendLog("error", err);
                    })
                  }
                >
                  删除
                </Button>
              </li>
            ))
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
