import { create } from "zustand";
import { api, type NoteMeta, type TagCount } from "../api/notes";
import { debounce } from "../debounce";

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
  load: () => Promise<void>;
  select: (id: string) => Promise<void>;
  create: () => Promise<string | null>;
  del: (id: string) => Promise<void>;
  undoDelete: () => Promise<void>;
  setTitle: (id: string, title: string) => Promise<void>;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  setTags: (id: string, tags: string[]) => Promise<void>;
  setBody: (body: string) => void;
  flushSave: () => Promise<void>;
  refreshTags: () => Promise<void>;
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

// Module-level debounced saver — one editor is open at a time.
const scheduleSave = debounce((body: string) => {
  void persistBody(body);
}, AUTOSAVE_MS);

async function persistBody(body: string) {
  const { selectedId } = useNotesStore.getState();
  if (!selectedId) return;
  useNotesStore.setState({ saveState: "saving" });
  try {
    await api.notes.update(selectedId, { body });
    if (useNotesStore.getState().selectedId === selectedId) {
      useNotesStore.setState({ saveState: "saved" });
    }
    await bumpTagRefresh();
  } catch (e) {
    console.error("autosave failed", e);
    useNotesStore.setState({ saveState: "dirty" });
  }
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
    if (get().selectedId === id) return;
    scheduleSave.cancel();
    // Save anything unsaved from the previous note before switching.
    const pending = get().saveState !== "saved" ? get().body : null;
    const note = await api.notes.read(id);
    set({ selectedId: id, body: note.body, saveState: "saved" });
    if (pending !== null) {
      await api.notes.update(get().selectedId!, { body: pending });
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
      const wasSelected = get().selectedId === id;
      if (wasSelected) {
        scheduleSave.cancel();
        set({ selectedId: null, body: null, saveState: "saved" });
      }
      set((s) => ({
        notes: s.notes.filter((n) => n.id !== id),
        lastDeleted: { id, title: note?.title ?? id },
      }));
      await get().refreshTags();
    } catch (e) {
      console.error("delete failed", e);
    }
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
    set({ body, saveState: "dirty" });
    scheduleSave(body);
  },

  flushSave: async () => {
    scheduleSave.flush();
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
