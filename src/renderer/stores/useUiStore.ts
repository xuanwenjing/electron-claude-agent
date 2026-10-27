import { create } from "zustand";

export type PanelId = "agent" | "crawl" | "update" | "notes";

type UiState = {
  currentPanel: PanelId;
  setPanel: (panel: PanelId) => void;
};

export const useUiStore = create<UiState>((set) => ({
  currentPanel: "agent",
  setPanel: (panel) => set({ currentPanel: panel }),
}));
