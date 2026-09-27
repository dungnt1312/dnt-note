import { describe, expect, it } from "vitest";
import { rankNoteCandidates } from "./MentionPlugin";
import type { NoteMeta } from "../../../lib/api/notes";

const note = (id: string, title: string, snippet = ""): NoteMeta =>
  ({ id, title, snippet, pinned: false, updated: "" }) as unknown as NoteMeta;

const notes = [
  note("1", "Roadmap Q4", "kế hoạch"),
  note("2", "Họp tuần", "roadmap thời gian"),
  note("3", "Sổ tay"),
];

describe("rankNoteCandidates", () => {
  it("ranks by title+snippet", () => {
    expect(rankNoteCandidates(notes, "road", []).map((n) => n.id)).toEqual(["1", "2"]);
  });

  it("empty query returns up to 8 notes", () => {
    const many = Array.from({ length: 12 }, (_, i) => note(`${i}`, `Ghi chú ${i}`));
    expect(rankNoteCandidates(many, "", []).length).toBeLessThanOrEqual(8);
  });

  it("excludes already-tokenized notes", () => {
    expect(rankNoteCandidates(notes, "road", ["1"]).map((n) => n.id)).toEqual(["2"]);
  });
});
