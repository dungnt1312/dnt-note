import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api/notes", () => ({
  api: {
    notes: {
      list: vi.fn(async () => [
        { id: "n1", title: "First", tags: ["a"], pinned: false, folder: null, created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z", snippet: "s1", wordCount: 1 },
        { id: "n2", title: "Second", tags: [], pinned: true, folder: null, created: "2026-01-02T00:00:00Z", updated: "2026-01-02T00:00:00Z", snippet: "s2", wordCount: 2 },
      ]),
      read: vi.fn(async (id: string) => ({ id, title: "First", tags: [], pinned: false, folder: null, created: "", updated: "", snippet: "", wordCount: 0, body: `body of ${id}` })),
      create: vi.fn(async () => ({ id: "new1", title: "Untitled", tags: [], pinned: false, folder: null, created: "", updated: "", snippet: "", wordCount: 0, body: "" })),
      update: vi.fn(async (_id: string, _patch: unknown) => ({ id: "x", title: "", tags: [], pinned: false, folder: null, created: "", updated: "", snippet: "", wordCount: 0, body: "" })),
      del: vi.fn(async () => {}),
      restore: vi.fn(async () => ({ id: "n1", title: "First", tags: [], pinned: false, folder: null, created: "", updated: "", snippet: "", wordCount: 0, body: "" })),
      tags: vi.fn(async () => []),
      moveToFolder: vi.fn(async (_id: string, _folder: string | null) => ({ id: "x", title: "", tags: [], pinned: false, folder: null, created: "", updated: "", snippet: "", wordCount: 0, body: "" })),
    },
    folders: {
      list: vi.fn(async () => []),
      create: vi.fn(async (name: string) => [name]),
      rename: vi.fn(async (_o: string, n: string) => ({ folders: [n], moved: 1 })),
      del: vi.fn(async () => ({ folders: [], moved: 2 })),
    },
  },
}));

import { api } from "../api/notes";
import { useNotesStore } from "./notesStore";

const mocked = vi.mocked(api.notes, true);

describe("notesStore autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotesStore.setState({
      notes: [],
      tags: [],
      selectedId: null,
      body: null,
      saveState: "saved",
      lastDeleted: null,
    });
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it("debounces setBody into a single update after 600ms", async () => {
    const s = useNotesStore.getState();
    await s.select("n1");
    vi.clearAllMocks();

    s.setBody("new text");
    s.setBody("newer text");
    expect(mocked.update).not.toHaveBeenCalled();
    expect(useNotesStore.getState().saveState).toBe("dirty");

    await vi.advanceTimersByTimeAsync(600);
    expect(mocked.update).toHaveBeenCalledTimes(1);
    expect(mocked.update).toHaveBeenCalledWith("n1", { body: "newer text" });
    expect(useNotesStore.getState().saveState).toBe("saved");
  });

  it("flushSave() saves immediately", async () => {
    const s = useNotesStore.getState();
    await s.select("n2");
    vi.clearAllMocks();
    s.setBody("forced");
    await s.flushSave();
    expect(mocked.update).toHaveBeenCalledWith("n2", { body: "forced" });
  });
});

describe("notesStore delete/undo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotesStore.setState({
      notes: [],
      tags: [],
      selectedId: null,
      body: null,
      saveState: "saved",
      lastDeleted: null,
    });
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it("del remembers the note and undoDelete restores it", async () => {
    const s = useNotesStore.getState();
    await s.load();
    expect(useNotesStore.getState().notes).toHaveLength(2);

    await s.del("n1");
    expect(mocked.del).toHaveBeenCalledWith("n1");
    expect(useNotesStore.getState().lastDeleted?.id).toBe("n1");

    await s.undoDelete();
    expect(mocked.restore).toHaveBeenCalledWith("n1");
    expect(useNotesStore.getState().lastDeleted).toBeNull();
  });

  it("undoDelete without lastDeleted does nothing", async () => {
    await useNotesStore.getState().undoDelete();
    expect(mocked.restore).not.toHaveBeenCalled();
  });
});

describe("notesStore folders", () => {
  beforeEach(() => {
    useNotesStore.setState({
      notes: [],
      folders: [],
      tags: [],
      selectedId: null,
      body: null,
      saveState: "saved",
      lastDeleted: null,
    });
    vi.clearAllMocks();
  });

  it("createFolder sets folders and returns null on success", async () => {
    const err = await useNotesStore.getState().createFolder("Work");
    expect(err).toBeNull();
    expect(useNotesStore.getState().folders).toEqual(["Work"]);
  });

  it("createFolder returns the error message on failure", async () => {
    vi.mocked(api.folders.create).mockRejectedValueOnce("note-error: folder already exists: Work");
    const err = await useNotesStore.getState().createFolder("Work");
    expect(err).toBe("note-error: folder already exists: Work");
    expect(useNotesStore.getState().folders).toEqual([]);
  });

  it("deleteFolder returns moved count and updates list", async () => {
    useNotesStore.setState({ folders: ["Work"] });
    const moved = await useNotesStore.getState().deleteFolder("Work");
    expect(moved).toBe(2);
    expect(useNotesStore.getState().folders).toEqual([]);
  });

  it("moveNoteToFolder updates note optimistically and returns previous folder", async () => {
    useNotesStore.setState({
      notes: [{ id: "n1", title: "A", tags: [], pinned: false, folder: "Work", created: "", updated: "", snippet: "", wordCount: 0 }],
    });
    const prev = await useNotesStore.getState().moveNoteToFolder("n1", "Life");
    expect(prev).toBe("Work");
    expect(useNotesStore.getState().notes[0].folder).toBe("Life");
    expect(api.notes.moveToFolder).toHaveBeenCalledWith("n1", "Life");
  });

  it("moveNoteToFolder rolls back on failure", async () => {
    useNotesStore.setState({
      notes: [{ id: "n1", title: "A", tags: [], pinned: false, folder: "Work", created: "", updated: "", snippet: "", wordCount: 0 }],
    });
    vi.mocked(api.notes.moveToFolder).mockRejectedValueOnce("note-error: x");
    const prev = await useNotesStore.getState().moveNoteToFolder("n1", "Life");
    expect(prev).toBe("error");
    expect(useNotesStore.getState().notes[0].folder).toBe("Work");
  });

  it("load() also fetches folders", async () => {
    vi.mocked(api.folders.list).mockResolvedValueOnce(["Work"]);
    await useNotesStore.getState().load();
    expect(useNotesStore.getState().folders).toEqual(["Work"]);
  });
});
