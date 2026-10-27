import { useEffect } from "react";
import { AppShell } from "@/layouts/AppShell";
import { AgentPage } from "@/pages/AgentPage";
import { CrawlPage } from "@/pages/CrawlPage";
import { NotesPage } from "@/pages/NotesPage";
import { UpdatePage } from "@/pages/UpdatePage";
import { useAgentStore } from "@/stores/useAgentStore";
import { useCrawlStore } from "@/stores/useCrawlStore";
import { useUiStore } from "@/stores/useUiStore";
import { useUpdaterStore } from "@/stores/useUpdaterStore";

export function App() {
  const panel = useUiStore((s) => s.currentPanel);

  useEffect(() => {
    useAgentStore.getState().init();
    useCrawlStore.getState().init();
    useUpdaterStore.getState().init();
  }, []);

  return (
    <AppShell>
      <div className={panel === "agent" ? "contents" : "hidden"}>
        <AgentPage />
      </div>
      <div className={panel === "crawl" ? "contents" : "hidden"}>
        <CrawlPage />
      </div>
      <div className={panel === "update" ? "contents" : "hidden"}>
        <UpdatePage />
      </div>
      <div className={panel === "notes" ? "contents" : "hidden"}>
        <NotesPage />
      </div>
    </AppShell>
  );
}
