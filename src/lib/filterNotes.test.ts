import { describe, it, expect } from "vitest";
import { filterNotes } from "./filterNotes";
import type { NoteMeta } from "./api/notes";

function meta(id: string, title: string, snippet: string): NoteMeta {
  return {
    id,
    title,
    tags: [],
    pinned: false,
    folder: null,
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:00Z",
    snippet,
    wordCount: 1,
  };
}

describe("filterNotes", () => {
  const notes = [
    meta("1", "Hướng dẫn Markdown", "cheat sheet"),
    meta("2", "Cuộc họp tuần", "kế hoạch quý"),
    meta("3", "Ý tưởng app", "markdown editor"),
  ];

  it("returns all notes for empty/whitespace query", () => {
    expect(filterNotes(notes, "")).toHaveLength(3);
    expect(filterNotes(notes, "   ")).toHaveLength(3);
  });

  it("matches title case-insensitively", () => {
    expect(filterNotes(notes, "markdown").map((n) => n.id)).toEqual(["1", "3"]);
    expect(filterNotes(notes, "HỌP").map((n) => n.id)).toEqual(["2"]);
  });

  it("matches snippet too", () => {
    expect(filterNotes(notes, "kế hoạch").map((n) => n.id)).toEqual(["2"]);
  });

  it("preserves store order", () => {
    expect(filterNotes(notes, "quý").map((n) => n.id)).toEqual(["2"]);
  });
});
