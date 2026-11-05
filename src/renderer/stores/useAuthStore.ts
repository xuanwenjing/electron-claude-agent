import { create } from "zustand";
import type { AuthState } from "../../shared/auth";

type State = AuthState & {
  ready: boolean;
  busy: boolean;
  error: string;
  restoreError: string;
  init: () => void;
  restore: () => Promise<void>;
  resetLogin: () => Promise<void>;
  login: (mobile: string, code: string) => Promise<void>;
};
let initialized = false;
let revision = 0;
export const useAuthStore = create<State>((set, get) => ({
  user: null,
  outlet: null,
  ready: false,
  busy: false,
  error: "",
  restoreError: "",
  init: () => {
    if (initialized) return;
    initialized = true;
    window.authApi.onSession((session) => {
      revision++;
      set({ ...session, ready: true, error: "", restoreError: "" });
    });
    void get().restore();
  },
  restore: async () => {
    const current = revision;
    set({ ready: false, restoreError: "" });
    try {
      const session = await window.authApi.getSession();
      if (current === revision) set({ ...session, ready: true });
    } catch (error) {
      if (current === revision)
        set({ ready: true, restoreError: String(error) });
    }
  },
  resetLogin: async () => {
    set({ busy: true });
    try {
      const result = await window.authApi.logout(false);
      if (result.ok)
        set({ ...result.session, ready: true, restoreError: "", error: "" });
      else set({ restoreError: result.error });
    } catch (error) {
      set({ restoreError: String(error) });
    } finally {
      set({ busy: false });
    }
  },
  login: async (mobile, code) => {
    set({ busy: true, error: "" });
    try {
      const result = await window.authApi.login(mobile, code);
      if (result.ok) set({ ...result.session, ready: true, restoreError: "" });
      else set({ error: result.error });
    } catch (err) {
      set({ error: String(err) });
    } finally {
      set({ busy: false });
    }
  },
}));
