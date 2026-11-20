import { create } from "zustand";

export type PanelId = "merchants" | "update";

type UiState = {
  currentPanel: PanelId;
  setPanel: (panel: PanelId) => void;
};

export const useUiStore = create<UiState>((set) => ({
  currentPanel: "merchants",
  setPanel: (panel) => set({ currentPanel: panel }),
}));
