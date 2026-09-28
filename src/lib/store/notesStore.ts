import { create } from "zustand";
import { api, type NoteMeta, type TagCount } from "../api/notes";
import { debounce } from "../debounce";
import { errMsg } from "../utils";
import { useUi } from "./uiStore";

export type SaveState = "saved" | "dirty" | "saving";

interface NotesState {
  notes: NoteMeta[];
  tags: TagCount[];
  /** Folder names (backend union of registry + folders found on notes). */
  folders: string[];
  selectedId: string | null;
  body: string | null;
  saveState: SaveState;
  lastDeleted: { id: string; title: string } | null;
  /** Bumped on every notes://changed event (external/on-disk changes). */
  changeSeq: number;
  bumpChangeSeq: () => void;
  load: () => Promise<void>;
  select: (id: string) => Promise<void>;
  create: () => Promise<string | null>;
  /** Delete a note. Resolves to true when deleted, false on failure. */
  del: (id: string) => Promise<boolean>;
  undoDelete: () => Promise<void>;
  setTitle: (id: string, title: string) => Promise<void>;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  setTags: (id: string, tags: string[]) => Promise<void>;
  setBody: (body: string) => void;
  /** Persist pending edits now; resolves once written, rejects if the save failed. */
  flushSave: () => Promise<void>;
  refreshTags: () => Promise<void>;
  /** Replace the open note's body with the on-disk version (after external edits). */
  reloadBody: (id: string) => Promise<void>;
  /** Reopen the note selected before the last reload; no-op when it no longer exists. */
  restoreSelection: () => Promise<void>;
  loadFolders: () => Promise<void>;
  /** Returns an error message on failure, null on success. */
  createFolder: (name: string) => Promise<string | null>;
  /** Returns the number of notes retargeted, or an error message. */
  renameFolder: (oldName: string, newName: string) => Promise<number | string>;
  /** Returns the number of notes moved back to root, or an error message. */
  deleteFolder: (name: string) => Promise<number | string>;
  /** Optimistic move; resolves to the note's previous folder (for Undo) or "error". */
  moveNoteToFolder: (id: string, folder: string | null) => Promise<string | null | "error">;
}

const AUTOSAVE_MS = 600;

// Last-open note survives a reload; validated against the fresh list at boot.
const LAST_NOTE_KEY = "dnt-last-note-id";

function rememberLastNote(id: string): void {
  try {
    localStorage.setItem(LAST_NOTE_KEY, id);
  } catch {
    // storage unavailable (private mode / quota) — selection just won't restore
  }
}

function readLastNote(): string | null {
  try {
    return localStorage.getItem(LAST_NOTE_KEY);
  } catch {
    return null;
  }
}

// Module-level debounced saver — one editor is open at a time.
// The note id is captured when scheduling, so a save can never land in another note.
const scheduleSave = debounce((id: string, body: string) => {
  persistBody(id, body).catch(() => {});
}, AUTOSAVE_MS);

let inFlight: Promise<void> | null = null;
// Bumped by every select(); stale selects bail out after each await.
let selectSeq = 0;
// Saves issued while leaving a note; reopening that note waits for them.
const pendingSwitchSaves = new Map<string, Promise<void>>();

/** Write `body` to note `id`; rejects on failure (state goes back to dirty if still open). */
function persistBody(id: string, body: string): Promise<void> {
  const isOpen = () => useNotesStore.getState().selectedId === id;
  if (isOpen()) useNotesStore.setState({ saveState: "saving" });
  const p = (async () => {
    try {
      await api.notes.update(id, { body });
      const cur = useNotesStore.getState();
      // Edits made during the request keep the note dirty.
      if (cur.selectedId === id && cur.body === body) {
        useNotesStore.setState({ saveState: "saved" });
      }
      void bumpTagRefresh();
    } catch (e) {
      console.error("autosave failed", e);
      if (isOpen()) useNotesStore.setState({ saveState: "dirty" });
      throw e;
    }
  })();
  const tracked: Promise<void> = p
    .catch(() => {})
    .finally(() => {
      if (inFlight === tracked) inFlight = null;
    });
  inFlight = tracked;
  return p;
}

let tagRefreshTimer: ReturnType<typeof setTimeout> | null = null;
async function bumpTagRefresh() {
  if (tagRefreshTimer) return;
  tagRefreshTimer = setTimeout(async () => {
    tagRefreshTimer = null;
    try {
      useNotesStore.setState({ tags: await api.notes.tags() });
    } catch {
      // tags are decorative in list view — ignore refresh failures
    }
  }, 1200);
}

export const useNotesStore = create<NotesState>()((set, get) => ({
  notes: [],
  changeSeq: 0,
  bumpChangeSeq: () => set((s) => ({ changeSeq: s.changeSeq + 1 })),
  tags: [],
  folders: [],
  selectedId: null,
  body: null,
  saveState: "saved",
  lastDeleted: null,

  load: async () => {
    const [notes, tags, folders] = await Promise.all([
      api.notes.list(),
      api.notes.tags(),
      api.folders.list(),
    ]);
    set({ notes, tags, folders });
  },

  select: async (id) => {
    const { selectedId: prevId, body: prevBody, saveState: prevState } = get();
    if (prevId === id) return;
    const seq = ++selectSeq;
    scheduleSave.cancel();
    rememberLastNote(id);
    // body null unmounts the editor, so nothing can be typed mid-switch.
    set({ selectedId: id, body: null, saveState: "saved" });
    const toast = useUi.getState().pushToast;
    if (prevId) {
      if (prevBody !== null && prevState !== "saved") {
        const save = (async () => {
          if (inFlight) await inFlight;
          await api.notes.update(prevId, { body: prevBody });
        })();
        const tracked = save.catch(() => {}).finally(() => {
          if (pendingSwitchSaves.get(prevId) === tracked) pendingSwitchSaves.delete(prevId);
        });
        pendingSwitchSaves.set(prevId, tracked);
        try {
          await save;
        } catch (e) {
          console.error("save before switch failed", e);
          toast({ message: `Không lưu được ghi chú: ${errMsg(e)}`, durationMs: 5000 });
        }
      }
      // Keep the finished session in history (best-effort).
      api.notes.snapshot(prevId).catch((e) => console.error("snapshot failed", e));
      if (seq !== selectSeq) return;
    }
    try {
      const pending = pendingSwitchSaves.get(id);
      if (pending) await pending;
      if (seq !== selectSeq) return;
      const note = await api.notes.read(id);
      if (seq !== selectSeq) return;
      set({ body: note.body, saveState: "saved" });
    } catch (e) {
      if (seq !== selectSeq) return;
      set({ body: null, saveState: "saved" });
      toast({ message: `Không mở được ghi chú: ${errMsg(e)}`, durationMs: 5000 });
    }
  },

  create: async () => {
    try {
      const note = await api.notes.create("Untitled", "", []);
      set((s) => ({ notes: [note, ...s.notes] }));
      await get().select(note.id);
      await get().refreshTags();
      return note.id;
    } catch (e) {
      console.error("create failed", e);
      return null;
    }
  },

  del: async (id) => {
    const note = get().notes.find((n) => n.id === id);
    try {
      await api.notes.del(id);
    } catch (e) {
      console.error("delete failed", e);
      return false;
    }
    const wasSelected = get().selectedId === id;
    if (wasSelected) {
      scheduleSave.cancel();
      try {
        localStorage.removeItem(LAST_NOTE_KEY);
      } catch {
        // ignore
      }
      set({ selectedId: null, body: null, saveState: "saved" });
    }
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== id),
      lastDeleted: { id, title: note?.title ?? id },
    }));
    await get().refreshTags();
    return true;
  },

  undoDelete: async () => {
    const { lastDeleted } = get();
    if (!lastDeleted) return;
    try {
      await api.notes.restore(lastDeleted.id);
      set({ lastDeleted: null });
      await get().load();
    } catch (e) {
      console.error("restore failed", e);
    }
  },

  setTitle: async (id, title) => {
    set((s) => ({
      notes: s.notes.map((n) => (n.id === id ? { ...n, title } : n)),
    }));
    try {
      await api.notes.update(id, { title });
    } catch (e) {
      console.error("rename failed", e);
    }
  },

  setPinned: async (id, pinned) => {
    set((s) => ({
      notes: s.notes.map((n) => (n.id === id ? { ...n, pinned } : n)),
    }));
    try {
      await api.notes.update(id, { pinned });
    } catch (e) {
      console.error("pin failed", e);
    }
  },

  setTags: async (id, tags) => {
    set((s) => ({
      notes: s.notes.map((n) => (n.id === id ? { ...n, tags } : n)),
    }));
    try {
      await api.notes.update(id, { tags });
      useNotesStore.setState({ tags: await api.notes.tags() });
    } catch (e) {
      console.error("tags failed", e);
    }
  },

  setBody: (body) => {
    const id = get().selectedId;
    if (!id) return;
    set({ body, saveState: "dirty" });
    scheduleSave(id, body);
  },

  flushSave: async () => {
    scheduleSave.cancel();
    if (inFlight) await inFlight;
    const { saveState, body, selectedId } = get();
    if (selectedId && body !== null && saveState !== "saved") await persistBody(selectedId, body);
  },

  reloadBody: async (id) => {
    const note = await api.notes.read(id);
    if (get().selectedId !== id) return;
    scheduleSave.cancel();
    set({ body: note.body, saveState: "saved" });
  },

  restoreSelection: async () => {
    if (get().selectedId !== null) return;
    const saved = readLastNote();
    if (!saved || !get().notes.some((n) => n.id === saved)) return;
    await get().select(saved);
  },

  refreshTags: async () => {
    try {
      set({ tags: await api.notes.tags() });
    } catch {
      // ignore
    }
  },

  loadFolders: async () => {
    try {
      set({ folders: await api.folders.list() });
    } catch (e) {
      console.error("load folders failed", e);
    }
  },

  createFolder: async (name) => {
    try {
      set({ folders: await api.folders.create(name) });
      return null;
    } catch (e) {
      console.error("create folder failed", e);
      return e instanceof Error ? e.message : String(e);
    }
  },

  renameFolder: async (oldName, newName) => {
    try {
      const { folders, moved } = await api.folders.rename(oldName, newName);
      set({ folders });
      return moved;
    } catch (e) {
      console.error("rename folder failed", e);
      return e instanceof Error ? e.message : String(e);
    }
  },

  deleteFolder: async (name) => {
    try {
      const { folders, moved } = await api.folders.del(name);
      set({ folders });
      return moved;
    } catch (e) {
      console.error("delete folder failed", e);
      return e instanceof Error ? e.message : String(e);
    }
  },

  moveNoteToFolder: async (id, folder) => {
    const prev = get().notes.find((n) => n.id === id)?.folder ?? null;
    if (prev === folder) return prev;
    set((s) => ({
      notes: s.notes.map((n) => (n.id === id ? { ...n, folder } : n)),
    }));
    try {
      await api.notes.moveToFolder(id, folder);
      return prev;
    } catch (e) {
      console.error("move to folder failed", e);
      set((s) => ({
        notes: s.notes.map((n) => (n.id === id ? { ...n, folder: prev } : n)),
      }));
      return "error";
    }
  },
}));
