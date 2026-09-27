import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api/notes", () => ({
  api: {
    notes: {
      list: vi.fn(async () => [
        { id: "n1", title: "First", tags: ["a"], pinned: false, created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z", snippet: "s1", wordCount: 1 },
        { id: "n2", title: "Second", tags: [], pinned: true, created: "2026-01-02T00:00:00Z", updated: "2026-01-02T00:00:00Z", snippet: "s2", wordCount: 2 },
      ]),
      read: vi.fn(async (id: string) => ({ id, title: "First", tags: [], pinned: false, created: "", updated: "", snippet: "", wordCount: 0, body: `body of ${id}` })),
      create: vi.fn(async () => ({ id: "new1", title: "Untitled", tags: [], pinned: false, created: "", updated: "", snippet: "", wordCount: 0, body: "" })),
      update: vi.fn(async (_id: string, _patch: unknown) => ({ id: "x", title: "", tags: [], pinned: false, created: "", updated: "", snippet: "", wordCount: 0, body: "" })),
      del: vi.fn(async () => {}),
      restore: vi.fn(async () => ({ id: "n1", title: "First", tags: [], pinned: false, created: "", updated: "", snippet: "", wordCount: 0, body: "" })),
      tags: vi.fn(async () => []),
      snapshot: vi.fn(async () => null),
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

  it("flushSave() resolves only after the write completes", async () => {
    const s = useNotesStore.getState();
    await s.select("n1");
    let release!: () => void;
    mocked.update.mockImplementationOnce(
      () => new Promise((r) => (release = () => r({} as never))),
    );
    s.setBody("slow");
    let done = false;
    const p = s.flushSave().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    expect(useNotesStore.getState().saveState).toBe("saving");
    release();
    await p;
    expect(done).toBe(true);
    expect(useNotesStore.getState().saveState).toBe("saved");
  });

  it("flushSave() waits for an in-flight autosave", async () => {
    const s = useNotesStore.getState();
    await s.select("n1");
    let release!: () => void;
    mocked.update.mockImplementationOnce(
      () => new Promise((r) => (release = () => r({} as never))),
    );
    s.setBody("auto");
    await vi.advanceTimersByTimeAsync(600);
    let done = false;
    const p = s.flushSave().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    release();
    await p;
    expect(mocked.update).toHaveBeenCalledTimes(1);
  });

  it("flushSave() rejects when the write fails", async () => {
    const s = useNotesStore.getState();
    await s.select("n1");
    mocked.update.mockRejectedValueOnce("disk full");
    s.setBody("x");
    await expect(s.flushSave()).rejects.toBe("disk full");
    expect(useNotesStore.getState().saveState).toBe("dirty");
  });

  it("select() flushes and snapshots the previous note when switching", async () => {
    const s = useNotesStore.getState();
    await s.select("n1");
    s.setBody("edited");
    await s.select("n2");
    expect(mocked.update).toHaveBeenCalledWith("n1", { body: "edited" });
    expect(mocked.update).not.toHaveBeenCalledWith("n2", expect.anything());
    expect(mocked.snapshot).toHaveBeenCalledWith("n1");
    expect(useNotesStore.getState()).toMatchObject({ selectedId: "n2", body: "body of n2" });
  });

  it("reloadBody() replaces the open body and marks it saved", async () => {
    const s = useNotesStore.getState();
    await s.select("n1");
    s.setBody("stale");
    await s.reloadBody("n1");
    expect(useNotesStore.getState()).toMatchObject({ body: "body of n1", saveState: "saved" });
    await vi.advanceTimersByTimeAsync(600);
    expect(mocked.update).not.toHaveBeenCalledWith("n1", { body: "stale" });
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
