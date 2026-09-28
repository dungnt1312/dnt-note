import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./api/notes", () => ({
  api: {
    notes: {
      list: vi.fn(async () => [
        { id: "n1", title: "First", tags: [], pinned: false, created: "", updated: "", snippet: "s1", wordCount: 1 },
        { id: "n2", title: "Second", tags: [], pinned: false, created: "", updated: "", snippet: "s2", wordCount: 2 },
      ]),
      read: vi.fn(async (id: string) => ({
        id,
        title: "First",
        tags: [],
        pinned: false,
        created: "",
        updated: "",
        snippet: "",
        wordCount: 0,
        body: `body of ${id}`,
      })),
      create: vi.fn(),
      update: vi.fn(),
      del: vi.fn(),
      restore: vi.fn(),
      tags: vi.fn(async () => []),
      search: vi.fn(),
      emptyTrash: vi.fn(),
      stats: vi.fn(),
    },
    folders: {
      list: vi.fn(async () => []),
      create: vi.fn(async (name: string) => [name]),
      rename: vi.fn(async (_o: string, n: string) => ({ folders: [n], moved: 0 })),
      del: vi.fn(async () => ({ folders: [], moved: 0 })),
    },
  },
}));

import { api } from "./api/notes";
import { useNotesStore } from "./store/notesStore";
import { useUi } from "./store/uiStore";
import { openNoteById, parseNoteHref } from "./openNote";

const mocked = vi.mocked(api.notes, true);

describe("parseNoteHref", () => {
  it("extracts the id from note:// references", () => {
    expect(parseNoteHref("note://n1")).toBe("n1");
    expect(parseNoteHref("note://abc-123_456")).toBe("abc-123_456");
  });

  it("rejects non-note or malformed hrefs", () => {
    expect(parseNoteHref("https://example.com")).toBeNull();
    expect(parseNoteHref("dntnote://note/n1")).toBeNull();
    expect(parseNoteHref("note://")).toBeNull();
  });
});

describe("openNoteById", () => {
  beforeEach(() => {
    useNotesStore.setState({
      notes: [],
      tags: [],
      selectedId: null,
      body: null,
      saveState: "saved",
      lastDeleted: null,
    });
    useUi.setState({ section: "chat", toasts: [] });
    vi.clearAllMocks();
  });

  it("selects an existing note and switches from chat to the notes workspace", async () => {
    useNotesStore.setState({ notes: await mocked.list() });
    useUi.setState({ section: "chat" });

    await expect(openNoteById("n1")).resolves.toBe(true);
    expect(useNotesStore.getState().selectedId).toBe("n1");
    expect(useNotesStore.getState().body).toBe("body of n1");
    expect(useUi.getState().section).toBe("notes");
  });

  it("refreshes the list first when the note is unknown (e.g. agent just created it)", async () => {
    expect(useNotesStore.getState().notes).toHaveLength(0);

    await openNoteById("n2");
    expect(mocked.list).toHaveBeenCalled();
    expect(useNotesStore.getState().selectedId).toBe("n2");
    expect(useNotesStore.getState().notes.some((n) => n.id === "n2")).toBe(true);
  });

  it("keeps the workspace and shows a toast when the note cannot be read", async () => {
    mocked.read.mockRejectedValueOnce(new Error("gone"));
    useNotesStore.setState({ notes: await mocked.list() });

    await expect(openNoteById("n1")).resolves.toBe(false);
    expect(useUi.getState().section).toBe("chat");
    expect(useUi.getState().toasts).toHaveLength(1);
    // Race-free select() marks the note selected but leaves body null on failure.
    expect(useNotesStore.getState().body).toBeNull();
  });

  it("does nothing for an empty id", async () => {
    await expect(openNoteById("")).resolves.toBe(false);
    expect(mocked.read).not.toHaveBeenCalled();
  });
});
