import { describe, it, expect } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { syntaxTree } from "@codemirror/language";
import {
  collectLineDecorations,
  frontmatterEndLine,
  toggleTaskAt,
  type DecorationSpec,
} from "./livePreview";

function makeState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: GFM })],
  });
}

function specsForLine(state: EditorState, lineNo: number): DecorationSpec[] {
  const line = state.doc.line(lineNo);
  const node = syntaxTree(state).resolveInner(line.from, 1);
  return collectLineDecorations(node, line.from, line.to, line.text, false);
}

describe("frontmatterEndLine", () => {
  it("returns closing fence line number", () => {
    const s = makeState("---\nid: x\n---\nbody");
    expect(frontmatterEndLine(s)).toBe(3);
  });
  it("returns 0 when no frontmatter", () => {
    const s = makeState("just text");
    expect(frontmatterEndLine(s)).toBe(0);
  });
  it("returns 0 when unclosed", () => {
    const s = makeState("---\nid: x");
    expect(frontmatterEndLine(s)).toBe(0);
  });
});

describe("live preview decorations", () => {
  it("hides heading marks on inactive lines and tags the line", () => {
    const s = makeState("# Tiêu đề\n\nbody");
    const specs = specsForLine(s, 1);
    const replace = specs.find((sp) => sp.kind === "replace");
    // The mark and its trailing space are hidden so the heading is not indented.
    expect(replace).toEqual({ kind: "replace", from: 0, to: 2 });
    expect(specs.some((sp) => sp.kind === "line" && sp.class === "cm-h1")).toBe(true);
  });

  it("handles multi-hash headings", () => {
    const s = makeState("## Hai");
    const specs = specsForLine(s, 1);
    expect(specs.some((sp) => sp.kind === "replace" && sp.from === 0 && sp.to === 3)).toBe(true);
    expect(specs.some((sp) => sp.kind === "line" && sp.class === "cm-h2")).toBe(true);
  });

  it("keeps raw marks on the active line", () => {
    const s = makeState("**bold**");
    const line = s.doc.line(1);
    const node = syntaxTree(s).resolveInner(line.from, 1);
    const specs = collectLineDecorations(node, line.from, line.to, line.text, true);
    expect(specs).toEqual([]);
  });

  it("marks bold text and hides asterisks when inactive", () => {
    const s = makeState("**bold**");
    const specs = specsForLine(s, 1);
    const bold = specs.find((sp) => sp.kind === "mark" && sp.class === "cm-bold");
    expect(bold).toEqual({ kind: "mark", from: 2, to: 6, class: "cm-bold" });
    const replaces = specs.filter((sp) => sp.kind === "replace");
    expect(replaces).toContainEqual({ kind: "replace", from: 0, to: 2 });
    expect(replaces).toContainEqual({ kind: "replace", from: 6, to: 8 });
  });

  it("marks inline code and hides backticks", () => {
    const s = makeState("a `code` b");
    const specs = specsForLine(s, 1);
    expect(specs.some((sp) => sp.kind === "mark" && sp.class === "cm-code")).toBe(true);
    const replaces = specs.filter((sp) => sp.kind === "replace");
    expect(replaces).toContainEqual({ kind: "replace", from: 2, to: 3 });
    expect(replaces).toContainEqual({ kind: "replace", from: 7, to: 8 });
  });

  it("task marker becomes a checkbox widget spec", () => {
    const s = makeState("- [x] done\n- [ ] todo");
    const done = specsForLine(s, 1);
    expect(done).toContainEqual({
      kind: "widget",
      from: 2,
      to: 5,
      widget: "checkbox",
      checked: true,
    });
    const todo = specsForLine(s, 2);
    expect(todo).toContainEqual({
      kind: "widget",
      from: 2,
      to: 5,
      widget: "checkbox",
      checked: false,
    });
  });

  it("fenced code lines get cm-code-block class", () => {
    const s = makeState("text\n\n```js\nconst a = 1;\n```\n");
    expect(specsForLine(s, 4).some((sp) => sp.kind === "line" && sp.class === "cm-code-block")).toBe(true);
  });

  it("fenced code gets begin/end classes so the block renders as one card", () => {
    const s = makeState("text\n\n```js\nconst a = 1;\n```\n");
    const first = specsForLine(s, 3);
    const last = specsForLine(s, 5);
    expect(first.some((sp) => sp.kind === "line" && sp.class.includes("cm-code-block-begin"))).toBe(true);
    expect(last.some((sp) => sp.kind === "line" && sp.class.includes("cm-code-block-end"))).toBe(true);
    expect(specsForLine(s, 4).some((sp) => sp.kind === "line" && sp.class.includes("-begin"))).toBe(false);
  });

  it("bullet marks become a bullet widget on inactive lines", () => {
    const s = makeState("- item one\n- item two");
    expect(specsForLine(s, 1)).toContainEqual({ kind: "widget", from: 0, to: 2, widget: "bullet", checked: false });
  });

  it("task list items do not get a bullet widget (checkbox only)", () => {
    const s = makeState("- [ ] todo");
    const specs = specsForLine(s, 1);
    expect(specs.some((sp) => sp.kind === "widget" && sp.widget === "bullet")).toBe(false);
    expect(specs).toContainEqual({ kind: "replace", from: 0, to: 2 });
  });

  it("ordered list numbers stay visible (styled, not replaced)", () => {
    const s = makeState("1. first");
    expect(specsForLine(s, 1)).toContainEqual({ kind: "mark", from: 0, to: 2, class: "cm-list-number" });
  });

  it("blockquote lines get a quote class and hide the marker", () => {
    const s = makeState("> quoted");
    const specs = specsForLine(s, 1);
    expect(specs.some((sp) => sp.kind === "line" && sp.class === "cm-quote")).toBe(true);
    expect(specs).toContainEqual({ kind: "replace", from: 0, to: 2 });
  });

  it("table lines get cm-table class", () => {
    const s = makeState("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(specsForLine(s, 2).some((sp) => sp.kind === "line" && sp.class === "cm-table")).toBe(true);
  });
});

describe("checkbox toggle", () => {
  function apply(state: EditorState, spec: TransactionSpec): EditorState {
    return state.update(spec).state;
  }

  it("toggles [ ] to [x] at the given position", () => {
    const s = makeState("- [ ] todo item");
    const next = apply(s, toggleTaskAt(s, 4));
    expect(next.doc.toString()).toBe("- [x] todo item");
  });

  it("toggles [x] back to [ ] (also uppercase)", () => {
    const s = makeState("- [X] done item");
    const next = apply(s, toggleTaskAt(s, 4));
    expect(next.doc.toString()).toBe("- [ ] done item");
  });

  it("is a no-op on lines without tasks", () => {
    const s = makeState("plain text");
    expect(toggleTaskAt(s, 2)).toEqual({});
  });
});
