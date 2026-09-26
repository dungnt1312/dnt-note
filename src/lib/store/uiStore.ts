import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  expiresAt: number;
}

interface UiState {
  searchQuery: string;
  tagFilter: string | null;
  paletteOpen: boolean;
  settingsOpen: boolean;
  toasts: Toast[];
  setSearchQuery: (q: string) => void;
  setTagFilter: (t: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  pushToast: (toast: Omit<Toast, "id" | "expiresAt"> & { durationMs?: number }) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export const useUi = create<UiState>()((set) => ({
  searchQuery: "",
  tagFilter: null,
  paletteOpen: false,
  settingsOpen: false,
  toasts: [],

  setSearchQuery: (q) => set({ searchQuery: q }),
  setTagFilter: (t) => set({ tagFilter: t }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  pushToast: ({ durationMs = 10000, onAction, actionLabel, message }) => {
    const id = ++toastSeq;
    const expiresAt = Date.now() + durationMs;
    set((s) => ({ toasts: [...s.toasts, { id, message, actionLabel, onAction, expiresAt }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, durationMs);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
