import { useEffect, useRef } from "react";
import type { LogLine } from "@/api/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const kindClass: Record<string, string> = {
  error: "text-red-700",
  result: "text-emerald-700",
  assistant: "text-sky-800",
  tool: "text-amber-800",
  log: "text-foreground/80",
};

export function LogView({ lines, className }: { lines: LogLine[]; className?: string }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  return (
    <ScrollArea className={cn("h-64 rounded-md border border-border bg-muted/40", className)}>
      <div className="min-w-max space-y-1 p-3 font-mono text-xs leading-relaxed">
        {lines.length === 0 ? (
          <p className="text-muted-foreground">暂无日志</p>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              className={cn(
                "whitespace-nowrap",
                kindClass[line.kind] || kindClass.log,
              )}
            >
              [{new Date(line.at).toLocaleTimeString()}] {line.text}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
