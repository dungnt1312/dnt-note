import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NoteList } from "./NoteList";
import type { NoteMeta } from "../../lib/api/notes";

function meta(id: string, title: string, extra: Partial<NoteMeta> = {}): NoteMeta {
  return {
    id,
    title,
    tags: [],
    pinned: false,
    folder: null,
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:00Z",
    snippet: `${title} snippet`,
    wordCount: 2,
    ...extra,
  };
}

const notes: NoteMeta[] = [
  meta("1", "Ghim trước", { pinned: true }),
  meta("2", "Markdown guide"),
  meta("3", "Họp team"),
];

describe("NoteList", () => {
  it("groups pinned notes before the rest", () => {
    render(<NoteList notes={notes} selectedId={null} onSelect={vi.fn()} />);
    const items = screen.getAllByRole("button", { name: /snippet/i });
    expect(items[0]).toHaveTextContent("Ghim trước");
    const sections = screen.getAllByRole("region");
    expect(sections[0]).toHaveAccessibleName("Đã ghim");
    expect(sections[1]).toHaveAccessibleName("Cũ hơn");
  });

  it("marks the selected note as current", () => {
    render(<NoteList notes={notes} selectedId="2" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { current: true })).toHaveTextContent("Markdown guide");
  });

  it("shows an empty message when nothing matches", () => {
    render(<NoteList notes={notes} selectedId={null} onSelect={vi.fn()} query="zzz" />);
    expect(screen.getByText("Không tìm thấy ghi chú phù hợp")).toBeInTheDocument();
  });

  it("calls onSelect when an item is clicked", () => {
    const onSelect = vi.fn();
    render(<NoteList notes={notes} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Họp team"));
    expect(onSelect).toHaveBeenCalledWith("3");
  });

  it("filters by query", () => {
    render(<NoteList notes={notes} selectedId={null} onSelect={vi.fn()} query="markdown" />);
    expect(screen.getByText("Markdown guide")).toBeInTheDocument();
    expect(screen.queryByText("Họp team")).not.toBeInTheDocument();
  });
});
