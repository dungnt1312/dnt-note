import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";

export type DecorationSpec =
  | { kind: "mark"; from: number; to: number; class: string }
  | { kind: "replace"; from: number; to: number }
  | { kind: "line"; class: string }
  | { kind: "widget"; from: number; to: number; widget: "checkbox"; checked: boolean };

const HEADING_LINE_CLASS: Record<string, string> = {
  ATXHeading1: "cm-h1",
  ATXHeading2: "cm-h2",
  ATXHeading3: "cm-h3",
  ATXHeading4: "cm-h4",
  ATXHeading5: "cm-h4",
  ATXHeading6: "cm-h4",
  SetextHeading1: "cm-h1",
  SetextHeading2: "cm-h2",
};

const INLINE_STYLES: Record<string, string> = {
  StrongEmphasis: "cm-bold",
  Emphasis: "cm-em",
  Strikethrough: "cm-strike",
  InlineCode: "cm-code",
};

const MARK_HIDE = new Set(["HeaderMark", "EmphasisMark", "StrikethroughMark", "CodeMark"]);

/**
 * Line number of the closing frontmatter fence (1-based), or 0 when the doc
 * has no (or an unclosed) frontmatter block.
 */
export function frontmatterEndLine(state: EditorState): number {
  if (state.doc.lines < 2) return 0;
  if (state.doc.line(1).text.trim() !== "---") return 0;
  for (let n = 2; n <= state.doc.lines; n++) {
    const t = state.doc.line(n).text.trim();
    if (t === "---" || t === "...") return n;
  }
  return 0;
}

/** Toggle the task marker on the line containing `pos`. */
export function toggleTaskAt(state: EditorState, pos: number): TransactionSpec {
  const line = state.doc.lineAt(pos);
  const m = /\[([ xX])\]/.exec(line.text);
  if (!m || m.index === undefined) return {};
  const from = line.from + m.index;
  return {
    changes: { from, to: from + 3, insert: `[${m[1] === " " ? "x" : " "}]` },
  };
}

function insideNodeOfType(node: SyntaxNode | null, name: string): boolean {
  let cur: SyntaxNode | null = node;
  while (cur) {
    if (cur.name === name) return true;
    cur = cur.parent;
  }
  return false;
}

/** Climb to the top-level block node (direct child of the Document node). */
function topBlockOf(node: SyntaxNode): SyntaxNode {
  let cur = node;
  while (cur.parent && cur.parent.name !== "Document") {
    cur = cur.parent;
  }
  return cur;
}

/**
 * Decorations for one line, in line-relative offsets. Pure — the ViewPlugin
 * turns these into CM Decorations. `isActive` lines keep their raw markdown.
 * `node` should be the innermost block node resolved AT (not before) the line
 * start: `syntaxTree(state).resolveInner(line.from, 1)`.
 */
export function collectLineDecorations(
  nodeRef: SyntaxNodeRef,
  lineFrom: number,
  lineTo: number,
  lineText: string,
  isActive: boolean,
): DecorationSpec[] {
  if (isActive) return [];

  const specs: DecorationSpec[] = [];
  const block = topBlockOf(nodeRef.node);

  // Block-level styling
  const headingClass = HEADING_LINE_CLASS[block.name];
  if (headingClass) {
    specs.push({ kind: "line", class: headingClass });
  } else if (block.name === "FencedCode" || insideNodeOfType(block, "FencedCode")) {
    specs.push({ kind: "line", class: "cm-code-block" });
    return specs;
  } else if (block.name === "Table" || insideNodeOfType(block, "Table")) {
    specs.push({ kind: "line", class: "cm-table" });
    return specs;
  }

  // Cursor-based traversal (children arrays are not available on all builds).
  const cursor = block.cursor();
  let ok = cursor.next(); // descend into the first child
  while (ok) {
    const cur: SyntaxNodeRef = cursor;
    const touchesLine = cur.to > lineFrom && cur.from < lineTo;
    if (!touchesLine) {
      ok = cursor.next(false); // skip this subtree
      continue;
    }
    if (MARK_HIDE.has(cur.name)) {
      specs.push({
        kind: "replace",
        from: cur.from - lineFrom,
        to: cur.to - lineFrom,
      });
    } else if (cur.name === "TaskMarker") {
      specs.push({
        kind: "widget",
        from: cur.from - lineFrom,
        to: cur.to - lineFrom,
        widget: "checkbox",
        checked: lineText.charAt(cur.from - lineFrom + 1) !== " ",
      });
    } else {
      const style = INLINE_STYLES[cur.name];
      if (style) {
        // Style only the content between the leading and trailing marks.
        const inner = cur.node;
        const first = inner?.firstChild;
        const last = inner?.lastChild;
        if (first && last && last !== first) {
          const from = first.to - lineFrom;
          const to = last.from - lineFrom;
          if (to > from) specs.push({ kind: "mark", from, to, class: style });
        }
      }
    }
    ok = cursor.next();
  }
  return specs;
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = "cm-checkbox";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(box);
      view.dispatch(toggleTaskAt(view.state, pos));
    });
    span.appendChild(box);
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const state = view.state;
  const fmEnd = frontmatterEndLine(state);
  const ranges: { from: number; to: number; value: Decoration }[] = [];

  const sel = state.selection.main;
  const activeLines = new Set([
    state.doc.lineAt(sel.head).number,
    state.doc.lineAt(sel.anchor).number,
  ]);

  for (const { from, to } of view.visibleRanges) {
    for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) {
      const line = state.doc.line(n);
      if (n <= fmEnd) {
        if (line.text.trim().length > 0) {
          ranges.push({
            from: line.from,
            to: line.from,
            value: Decoration.line({ class: "cm-frontmatter" }),
          });
        }
        continue;
      }
      const node = syntaxTree(state).resolveInner(line.from, 1);
      const isActive = activeLines.has(n);
      for (const spec of collectLineDecorations(node, line.from, line.to, line.text, isActive)) {
        if (spec.kind === "line") {
          ranges.push({ from: line.from, to: line.from, value: Decoration.line({ class: spec.class }) });
        } else if (spec.kind === "mark") {
          ranges.push({
            from: line.from + spec.from,
            to: line.from + spec.to,
            value: Decoration.mark({ class: spec.class }),
          });
        } else if (spec.kind === "replace") {
          const a = line.from + spec.from;
          const b = line.from + spec.to;
          if (b > a) ranges.push({ from: a, to: b, value: Decoration.replace({}) });
        } else {
          const a = line.from + spec.from;
          const b = line.from + spec.to;
          if (b > a) {
            ranges.push({
              from: a,
              to: b,
              value: Decoration.replace({ widget: new CheckboxWidget(spec.checked) }),
            });
          }
        }
      }
    }
  }

  return Decoration.set(ranges, true);
}

/** Obsidian-style live preview extension for markdown documents. */
export function livePreview(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }
      update(u: {
        view: EditorView;
        docChanged: boolean;
        viewportChanged: boolean;
        selectionSet: boolean;
      }) {
        if (u.docChanged || u.viewportChanged || u.selectionSet) {
          this.decorations = buildDecorations(u.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}
