import { create } from "zustand";
import { mediaApi, type MediaItem } from "../api/media";
import { isTauri } from "../env";
import { errMsg } from "../utils";
import { useNotesStore } from "./notesStore";

export type MediaFilter = "all" | "image" | "document" | "audio" | "unused";

export function filterMedia(items: MediaItem[], filter: MediaFilter, query: string): MediaItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((i) => {
    if (filter === "unused" && i.usedBy.length > 0) return false;
    if (filter !== "all" && filter !== "unused" && i.kind !== filter) return false;
    return !q || i.displayName.toLowerCase().includes(q);
  });
}

export function countMedia(items: MediaItem[]): Record<MediaFilter, number> {
  const c: Record<MediaFilter, number> = { all: items.length, image: 0, document: 0, audio: 0, unused: 0 };
  for (const i of items) {
    if (i.kind === "image" || i.kind === "document" || i.kind === "audio") c[i.kind]++;
    if (i.usedBy.length === 0) c.unused++;
  }
  return c;
}

export interface ImportResult {
  imported: number;
  total: number;
  firstError: string | null;
}

/**
 * Run a backend op that may rewrite notes linking `name`. If the open note is one of
 * them, save it first and reload its body afterwards so autosave can't restore stale links.
 */
async function withOpenNoteSync<T>(item: MediaItem | undefined, op: () => Promise<T>): Promise<T> {
  const notes = useNotesStore.getState();
  const openId = notes.selectedId;
  const affected = !!openId && !!item?.usedBy.some((n) => n.id === openId);
  if (affected) await notes.flushSave();
  const result = await op();
  if (affected && openId) await useNotesStore.getState().reloadBody(openId);
  return result;
}

interface MediaState {
  items: MediaItem[];
  loading: boolean;
  filter: MediaFilter;
  query: string;
  selectedName: string | null;
  load: () => Promise<void>;
  setFilter: (f: MediaFilter) => void;
  setQuery: (q: string) => void;
  select: (name: string | null) => void;
  rename: (name: string, newName: string) => Promise<void>;
  remove: (name: string, force: boolean) => Promise<void>;
  importFiles: (paths: string[]) => Promise<ImportResult>;
}

export const useMediaStore = create<MediaState>()((set, get) => ({
  items: [],
  loading: false,
  filter: "all",
  query: "",
  selectedName: null,

  load: async () => {
    if (!isTauri) {
      set({ items: [], loading: false });
      return;
    }
    set({ loading: true });
    try {
      const items = await mediaApi.list();
      const sel = get().selectedName;
      set({ items, selectedName: sel && items.some((i) => i.name === sel) ? sel : null });
    } finally {
      set({ loading: false });
    }
  },
  setFilter: (filter) => set({ filter }),
  setQuery: (query) => set({ query }),
  select: (selectedName) => set({ selectedName }),

  rename: async (name, newName) => {
    const item = get().items.find((i) => i.name === name);
    const stored = await withOpenNoteSync(item, () => mediaApi.rename(name, newName));
    set({ selectedName: stored });
    await get().load();
  },
  remove: async (name, force) => {
    const item = get().items.find((i) => i.name === name);
    await withOpenNoteSync(item, () => mediaApi.del(name, force));
    if (get().selectedName === name) set({ selectedName: null });
    await get().load();
  },
  importFiles: async (paths) => {
    let imported = 0;
    let firstError: string | null = null;
    let last: string | null = null;
    for (const p of paths) {
      try {
        last = await mediaApi.import(p);
        imported++;
      } catch (e) {
        firstError ??= errMsg(e);
      }
    }
    if (last) set({ selectedName: last });
    await get().load();
    return { imported, total: paths.length, firstError };
  },
}));
