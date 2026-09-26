import { describe, it, expect } from "vitest";
import { fuzzyMatch, fuzzyRank } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches subsequence case-insensitively", () => {
    expect(fuzzyMatch("dnt", "DNT Note")).not.toBeNull();
    expect(fuzzyMatch("dn", "DNT Note")).not.toBeNull();
    expect(fuzzyMatch("ghi chu", "Ghi chú đầu tiên")).not.toBeNull();
  });

  it("returns null when not a subsequence", () => {
    expect(fuzzyMatch("xyz", "DNT Note")).toBeNull();
  });

  it("empty query matches with neutral score", () => {
    expect(fuzzyMatch("", "anything")).toBe(0);
  });

  it("scores consecutive and word-start matches higher", () => {
    const consecutive = fuzzyMatch("dnt", "DNT Note")!;
    const spread = fuzzyMatch("dnt", "D N T")!;
    expect(consecutive).toBeGreaterThan(spread);
    const wordStart = fuzzyMatch("nt", "Note Title")!;
    const midWord = fuzzyMatch("nt", "connect")!;
    expect(wordStart).toBeGreaterThan(midWord);
  });

  it("exact substring scores highest", () => {
    const text = "Markdown cheat sheet";
    const exact = fuzzyMatch("markdown", text)!;
    const subseq = fuzzyMatch("mks", text)!;
    expect(exact).toBeGreaterThan(subseq);
  });
});

describe("fuzzyRank", () => {
  const items = [
    { id: "a", text: "Cuộc họp tuần" },
    { id: "b", text: "Hướng dẫn Markdown" },
    { id: "c", text: "Markdown cheat sheet" },
  ];

  it("returns only matching items sorted by score desc", () => {
    const ranked = fuzzyRank(items, "markdown");
    expect(ranked.map((r) => r.item.id)).toEqual(["c", "b"]);
  });

  it("keeps original order for empty query", () => {
    expect(fuzzyRank(items, "").map((r) => r.item.id)).toEqual(["a", "b", "c"]);
  });
});
