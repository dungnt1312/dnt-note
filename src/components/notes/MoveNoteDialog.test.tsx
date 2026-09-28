import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MoveNoteDialog } from "./MoveNoteDialog";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";

vi.mock("../../lib/api/notes", () => ({
  api: {
    notes: {
      moveToFolder: vi.fn(async () => ({
        id: "x", title: "", tags: [], pinned: false, folder: null, created: "", updated: "", snippet: "", wordCount: 0, body: "",
      })),
    },
    folders: { list: vi.fn(async () => ["Work", "Life"]) },
  },
}));

const meta = (over: Record<string, unknown> = {}) => ({
  id: "n1", title: "Ghi chú A", tags: [], pinned: false, folder: null,
  created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z", snippet: "", wordCount: 0,
  ...over,
});

describe("MoveNoteDialog", () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: [meta()], folders: ["Work", "Life"], tags: [] });
    useUi.setState({ toasts: [] });
    vi.clearAllMocks();
  });

  it("lists folders and marks the current one selected", () => {
    render(<MoveNoteDialog note={meta({ folder: "Work" })} onClose={() => {}} />);
    expect(screen.getByRole("option", { name: /Work/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /Không có thư mục/ })).toHaveAttribute("aria-selected", "false");
  });

  it("picks a folder, closes, and toasts with Undo restoring the previous folder", async () => {
    const onClose = vi.fn();
    render(<MoveNoteDialog note={meta()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("option", { name: /Work/ }));
    await vi.waitFor(() => expect(useUi.getState().toasts.length).toBeGreaterThan(0));
    expect(onClose).toHaveBeenCalled();
    expect(useNotesStore.getState().notes[0].folder).toBe("Work");
    const toast = useUi.getState().toasts[0];
    expect(toast.message).toContain("Đã chuyển tới");
    toast.onAction?.();
    await vi.waitFor(() => expect(useNotesStore.getState().notes[0].folder).toBeNull());
  });

  it("renders nothing when note is null", () => {
    const { container } = render(<MoveNoteDialog note={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
