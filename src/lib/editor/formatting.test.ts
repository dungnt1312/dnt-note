import { describe, it, expect } from "vitest";
import { EditorState, EditorSelection, type TransactionSpec } from "@codemirror/state";
import { toggleWrap, setHeading, toggleLinePrefix, insertBlock, insertLink } from "./formatting";

function state(doc: string, from: number, to = from) {
  return EditorState.create({ doc, selection: EditorSelection.single(from, to) });
}
function run(s: EditorState, spec: TransactionSpec) {
  return s.update(spec).state;
}

describe("toggleWrap", () => {
  it("wraps the selection and keeps it selected", () => {
    const next = run(state("hello world", 0, 5), toggleWrap(state("hello world", 0, 5), "**"));
    expect(next.doc.toString()).toBe("**hello** world");
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe("hello");
  });

  it("unwraps when the selection is already wrapped", () => {
    const s = state("**hello** world", 2, 7);
    expect(run(s, toggleWrap(s, "**")).doc.toString()).toBe("hello world");
  });

  it("inserts an empty pair with the caret inside when nothing is selected", () => {
    const s = state("ab", 1);
    const next = run(s, toggleWrap(s, "*"));
    expect(next.doc.toString()).toBe("a**b");
    expect(next.selection.main.head).toBe(2);
  });
});

describe("setHeading", () => {
  it("sets, replaces and removes heading levels", () => {
    let s = state("Title\nbody", 2);
    s = run(s, setHeading(s, 2));
    expect(s.doc.line(1).text).toBe("## Title");
    s = run(s, setHeading(s, 1));
    expect(s.doc.line(1).text).toBe("# Title");
    s = run(s, setHeading(s, 0));
    expect(s.doc.line(1).text).toBe("Title");
  });
});

describe("toggleLinePrefix", () => {
  it("adds bullets to every selected line and removes them again", () => {
    let s = state("a\nb\nc", 0, 3);
    s = run(s, toggleLinePrefix(s, "bullet"));
    expect(s.doc.toString()).toBe("- a\n- b\nc");
    s = run(s, toggleLinePrefix(s, "bullet"));
    expect(s.doc.toString()).toBe("a\nb\nc");
  });

  it("numbers lines sequentially", () => {
    const s = state("a\nb", 0, 3);
    expect(run(s, toggleLinePrefix(s, "numbered")).doc.toString()).toBe("1. a\n2. b");
  });

  it("converts a bullet into a checklist item", () => {
    const s = state("- a", 3);
    expect(run(s, toggleLinePrefix(s, "task")).doc.toString()).toBe("- [ ] a");
  });

  it("toggles quotes", () => {
    const s = state("> a", 1);
    expect(run(s, toggleLinePrefix(s, "quote")).doc.toString()).toBe("a");
  });
});

describe("insertBlock / insertLink", () => {
  it("inserts a fenced code block on its own lines", () => {
    const s = state("text", 4);
    expect(run(s, insertBlock(s, "code")).doc.toString()).toBe("text\n```\n\n```\n");
  });

  it("wraps the selection as link text and selects the url", () => {
    const s = state("see docs", 4, 8);
    const next = run(s, insertLink(s));
    expect(next.doc.toString()).toBe("see [docs](https://)");
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe("https://");
  });
});
