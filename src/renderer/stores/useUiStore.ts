import { create } from "zustand";

export type PanelId = "crawl" | "update" | "notes";

type UiState = {
  currentPanel: PanelId;
  setPanel: (panel: PanelId) => void;
};

export const useUiStore = create<UiState>((set) => ({
  currentPanel: "crawl",
  setPanel: (panel) => set({ currentPanel: panel }),
}));
