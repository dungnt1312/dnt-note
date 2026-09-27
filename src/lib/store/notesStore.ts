import { create } from "zustand";
import { api, type NoteMeta, type TagCount } from "../api/notes";
import { debounce } from "../debounce";
import { errMsg } from "../utils";
import { useUi } from "./uiStore";

export type SaveState = "saved" | "dirty" | "saving";

interface NotesState {
  notes: NoteMeta[];
  tags: TagCount[];
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
  /** Persist pending edits now; resolves once written, rejects if the save failed. */
  flushSave: () => Promise<void>;
  refreshTags: () => Promise<void>;
  /** Replace the open note's body with the on-disk version (after external edits). */
  reloadBody: (id: string) => Promise<void>;
}

const AUTOSAVE_MS = 600;

// Module-level debounced saver — one editor is open at a time.
// The note id is captured when scheduling, so a save can never land in another note.
const scheduleSave = debounce((id: string, body: string) => {
  persistBody(id, body).catch(() => {});
}, AUTOSAVE_MS);

let inFlight: Promise<void> | null = null;
// Bumped by every select(); stale selects bail out after each await.
let selectSeq = 0;

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
  tags: [],
  selectedId: null,
  body: null,
  saveState: "saved",
  lastDeleted: null,

  load: async () => {
    const [notes, tags] = await Promise.all([api.notes.list(), api.notes.tags()]);
    set({ notes, tags });
  },

  select: async (id) => {
    const { selectedId: prevId, body: prevBody, saveState: prevState } = get();
    if (prevId === id) return;
    const seq = ++selectSeq;
    scheduleSave.cancel();
    // body null unmounts the editor, so nothing can be typed mid-switch.
    set({ selectedId: id, body: null, saveState: "saved" });
    const toast = useUi.getState().pushToast;
    if (prevId) {
      if (prevBody !== null && prevState !== "saved") {
        try {
          if (inFlight) await inFlight;
          await api.notes.update(prevId, { body: prevBody });
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

  refreshTags: async () => {
    try {
      set({ tags: await api.notes.tags() });
    } catch {
      // ignore
    }
  },
}));
