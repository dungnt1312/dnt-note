import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  expiresAt: number;
}

/** Main content area: notes workspace, full-screen assistant or settings page. */
export type Section = "notes" | "chat" | "media" | "settings";
/** Which list the sidebar shows (notes or chat sessions). */
export type Workspace = "notes" | "chat" | "media";

interface UiState {
  searchQuery: string;
  tagFilter: string | null;
  /** Selected folder in the sidebar (null = all notes). Filters together with tagFilter. */
  folderFilter: string | null;
  paletteOpen: boolean;
  section: Section;
  workspace: Workspace;
  sidebarVisible: boolean;
  /** Assistant panel docked next to the editor (notes section only). */
  chatOpen: boolean;
  /** Mirrors `section === "settings"` for callers that treat settings as a dialog. */
  settingsOpen: boolean;
  toasts: Toast[];
  setSearchQuery: (q: string) => void;
  setTagFilter: (t: string | null) => void;
  setFolderFilter: (f: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
  setSection: (section: Section) => void;
  toggleSidebar: () => void;
  setChatOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  pushToast: (toast: Omit<Toast, "id" | "expiresAt"> & { durationMs?: number }) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;
let sectionBeforeSettings: Section = "notes";

export const useUi = create<UiState>()((set, get) => ({
  searchQuery: "",
  tagFilter: null,
  folderFilter: null,
  paletteOpen: false,
  section: "notes",
  workspace: "notes",
  sidebarVisible: true,
  chatOpen: false,
  settingsOpen: false,
  toasts: [],

  setSearchQuery: (q) => set({ searchQuery: q }),
  setTagFilter: (t) => set({ tagFilter: t }),
  setFolderFilter: (f) => set({ folderFilter: f }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  setSection: (section) => {
    const cur = get().section;
    if (cur !== "settings") sectionBeforeSettings = cur;
    set({
      section,
      settingsOpen: section === "settings",
      // Settings keeps whichever list the sidebar was showing.
      ...(section === "settings" ? {} : { workspace: section }),
    });
  },
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  setChatOpen: (open) => set({ chatOpen: open }),

  setSettingsOpen: (open) => {
    if (open) get().setSection("settings");
    else if (get().section === "settings") get().setSection(sectionBeforeSettings);
  },

  pushToast: ({ durationMs = 10000, onAction, actionLabel, message }) => {
    const id = ++toastSeq;
    const expiresAt = Date.now() + durationMs;
    // One toast at a time, Studio style: a new message replaces the old one.
    set({ toasts: [{ id, message, actionLabel, onAction, expiresAt }] });
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, durationMs);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
