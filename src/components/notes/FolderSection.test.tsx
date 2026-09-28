import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FolderSection } from "./FolderSection";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";

vi.mock("../../lib/api/notes", () => ({
  api: {
    notes: {
      moveToFolder: vi.fn(async () => ({
        id: "x", title: "", tags: [], pinned: false, folder: null, created: "", updated: "", snippet: "", wordCount: 0, body: "",
      })),
      list: vi.fn(async () => []),
      tags: vi.fn(async () => []),
    },
    folders: {
      list: vi.fn(async () => ["Work"]),
      create: vi.fn(async (name: string) => [name]),
      rename: vi.fn(async (_o: string, n: string) => ({ folders: [n], moved: 1 })),
      del: vi.fn(async () => ({ folders: [], moved: 1 })),
    },
  },
}));

import { api } from "../../lib/api/notes";

const meta = (over: Record<string, unknown> = {}) => ({
  id: "n1", title: "A", tags: [], pinned: false, folder: null,
  created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z", snippet: "", wordCount: 0,
  ...over,
});

describe("FolderSection", () => {
  beforeEach(() => {
    useNotesStore.setState({
      notes: [meta({ id: "n1", folder: "Work" }), meta({ id: "n2" })],
      folders: ["Work"],
      tags: [],
    });
    useUi.setState({ folderFilter: null, toasts: [] });
    vi.clearAllMocks();
  });

  it("renders folder rows with counts and toggles the filter on click", () => {
    render(<FolderSection />);
    expect(screen.getByLabelText("Thư mục Work, 1 ghi chú")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Thư mục Work, 1 ghi chú"));
    expect(useUi.getState().folderFilter).toBe("Work");
    fireEvent.click(screen.getByLabelText("Thư mục Work, 1 ghi chú"));
    expect(useUi.getState().folderFilter).toBeNull();
  });

  it("creates a folder via the inline input", () => {
    render(<FolderSection />);
    fireEvent.click(screen.getByLabelText("Thư mục mới"));
    const input = screen.getByLabelText("Tên thư mục");
    fireEvent.change(input, { target: { value: "Life" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(api.folders.create).toHaveBeenCalledWith("Life");
  });

  it("rejects duplicate folder names with a toast, without calling the api", () => {
    render(<FolderSection />);
    fireEvent.click(screen.getByLabelText("Thư mục mới"));
    const input = screen.getByLabelText("Tên thư mục");
    fireEvent.change(input, { target: { value: "work" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(api.folders.create).not.toHaveBeenCalled();
    expect(useUi.getState().toasts[0].message).toContain("đã tồn tại");
  });

  it("clears a stale folderFilter when the folder disappears", () => {
    useUi.setState({ folderFilter: "Gone" });
    render(<FolderSection />);
    expect(useUi.getState().folderFilter).toBeNull();
  });
});
