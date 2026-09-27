import { describe, it, expect } from "vitest";
import { parseWikiLinks, wikiCompletionSource } from "./wikiLinks";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";

describe("parseWikiLinks", () => {
  it("finds plain and aliased links with offsets", () => {
    const text = "a [[Ghi chú]] b [[ Kế hoạch | plan ]]";
    expect(parseWikiLinks(text)).toEqual([
      { from: 2, to: 13, target: "Ghi chú" },
      { from: 16, to: text.length, target: "Kế hoạch", alias: "plan" },
    ]);
  });
  it("rejects empty, nested and multi-line", () => {
    expect(parseWikiLinks("[[]] [[ ]] [[a\nb]] [[a[[b]]")).toEqual([
      { from: 22, to: 27, target: "b" },
    ]);
  });
  it("ignores code spans and fenced blocks", () => {
    const text = "`[[A]]` x\n```\n[[B]]\n```\n[[C]]";
    expect(parseWikiLinks(text).map((l) => l.target)).toEqual(["C"]);
  });
});

describe("wikiCompletionSource", () => {
  it("suggests titles after [[ and applies Title]]", () => {
    const doc = "see [[ke";
    const ctx = new CompletionContext(EditorState.create({ doc }), doc.length, false);
    const res = wikiCompletionSource(() => ["Kế hoạch", "keo", "Zeta"])(ctx);
    expect(res?.from).toBe(6);
    expect(res?.options.map((o) => o.label)).toContain("keo");
    expect(res?.options.find((o) => o.label === "keo")?.apply).toBe("keo]]");
    expect(res?.options.map((o) => o.label)).not.toContain("Zeta");
  });
  it("returns null without [[", () => {
    const ctx = new CompletionContext(EditorState.create({ doc: "abc" }), 3, false);
    expect(wikiCompletionSource(() => ["a"])(ctx)).toBeNull();
  });
});
