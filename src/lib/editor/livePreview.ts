import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { EditorState, StateEffect, StateField, type Extension, type TransactionSpec } from "@codemirror/state";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { onAttachmentsDirReady, rewriteAttachmentSrc } from "../media/attachmentUrl";

export type DecorationSpec =
  | { kind: "mark"; from: number; to: number; class: string }
  | { kind: "replace"; from: number; to: number }
  | { kind: "line"; class: string }
  | { kind: "widget"; from: number; to: number; widget: "checkbox" | "bullet"; checked: boolean }
  // Block image rendered below the line; `src` is the raw markdown URL.
  | { kind: "widget"; from: number; to: number; widget: "image"; src: string };

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

const MARK_HIDE = new Set(["EmphasisMark", "StrikethroughMark", "CodeMark"]);

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

function ancestorOfType(node: SyntaxNode | null, name: string): SyntaxNode | null {
  let cur: SyntaxNode | null = node;
  while (cur) {
    if (cur.name === name) return cur;
    cur = cur.parent;
  }
  return null;
}

/** Climb to the top-level block node (direct child of the Document node). */
function topBlockOf(node: SyntaxNode): SyntaxNode {
  let cur = node;
  while (cur.parent && cur.parent.name !== "Document") {
    cur = cur.parent;
  }
  return cur;
}

/** Hide a mark plus the single space that follows it (`# `, `> `, `- `). */
function hideWithSpace(from: number, to: number, lineText: string): DecorationSpec {
  const end = lineText.charAt(to) === " " ? to + 1 : to;
  return { kind: "replace", from, to: end };
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
  const block = topBlockOf(nodeRef.node);

  // Code blocks keep their card styling even on the active line, so the block
  // does not visually break apart while typing inside it.
  const fenced = block.name === "FencedCode" ? block : ancestorOfType(nodeRef.node, "FencedCode");
  if (fenced) {
    const classes = ["cm-code-block"];
    if (fenced.from >= lineFrom) classes.push("cm-code-block-begin");
    if (fenced.to <= lineTo) classes.push("cm-code-block-end");
    return [{ kind: "line", class: classes.join(" ") }];
  }
  if (isActive) return [];

  const specs: DecorationSpec[] = [];

  const headingClass = HEADING_LINE_CLASS[block.name];
  if (headingClass) {
    specs.push({ kind: "line", class: headingClass });
  } else if (block.name === "Table" || ancestorOfType(block, "Table")) {
    specs.push({ kind: "line", class: "cm-table" });
    return specs;
  } else if (block.name === "Blockquote") {
    specs.push({ kind: "line", class: "cm-quote" });
  } else if (block.name === "HorizontalRule") {
    specs.push({ kind: "line", class: "cm-hr" });
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
    const from = cur.from - lineFrom;
    const to = cur.to - lineFrom;
    if (cur.name === "HeaderMark") {
      // Setext underline marks sit on their own line; ATX marks lead the line.
      specs.push(from === 0 ? hideWithSpace(from, to, lineText) : { kind: "replace", from, to });
    } else if (cur.name === "QuoteMark") {
      specs.push(hideWithSpace(from, to, lineText));
    } else if (cur.name === "ListMark") {
      const isOrdered = cur.node.parent?.parent?.name === "OrderedList";
      const isTask = /^\s*\[[ xX]\]/.test(lineText.slice(to + 1));
      if (isOrdered) {
        specs.push({ kind: "mark", from, to, class: "cm-list-number" });
      } else if (isTask) {
        specs.push(hideWithSpace(from, to, lineText));
      } else {
        const end = lineText.charAt(to) === " " ? to + 1 : to;
        specs.push({ kind: "widget", from, to: end, widget: "bullet", checked: false });
      }
    } else if (cur.name === "Image") {
      const urlNode = cur.node.getChild("URL");
      if (urlNode) {
        const src = lineText.slice(urlNode.from - lineFrom, urlNode.to - lineFrom);
        specs.push({ kind: "widget", from: lineText.length, to: lineText.length, widget: "image", src });
      }
      ok = cursor.next(false);
      continue;
    } else if (MARK_HIDE.has(cur.name)) {
      specs.push({ kind: "replace", from, to });
    } else if (cur.name === "TaskMarker") {
      specs.push({
        kind: "widget",
        from,
        to,
        widget: "checkbox",
        checked: lineText.charAt(from + 1) !== " ",
      });
    } else {
      const style = INLINE_STYLES[cur.name];
      if (style) {
        // Style only the content between the leading and trailing marks.
        const inner = cur.node;
        const first = inner?.firstChild;
        const last = inner?.lastChild;
        if (first && last && last !== first) {
          const a = first.to - lineFrom;
          const b = last.from - lineFrom;
          if (b > a) specs.push({ kind: "mark", from: a, to: b, class: style });
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
    box.setAttribute("aria-label", this.checked ? "Đã xong" : "Chưa xong");
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

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-bullet";
    span.setAttribute("aria-hidden", "true");
    span.textContent = "•";
    return span;
  }
}

const bulletWidget = new BulletWidget();

class ImageWidget extends WidgetType {
  constructor(readonly src: string) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src;
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-image-block";
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = "";
    img.style.maxWidth = "100%";
    img.style.maxHeight = "360px";
    img.style.display = "block";
    wrap.appendChild(img);
    return wrap;
  }
}

/** Resolved displayable URL, or "" when the image cannot be shown (e.g. browser mode). */
function imageDisplaySrc(raw: string): string {
  const src = rewriteAttachmentSrc(raw);
  return /^(https?:|asset:|data:)/i.test(src) ? src : "";
}

function buildDecorations(view: EditorView): DecorationSet {
  const state = view.state;
  const fmEnd = frontmatterEndLine(state);
  const ranges: { from: number; to: number; value: Decoration }[] = [];

  // Without focus every line renders as preview — the caret is not visible anyway.
  const activeLines = new Set<number>();
  if (view.hasFocus) {
    for (const r of state.selection.ranges) {
      const a = state.doc.lineAt(r.from).number;
      const b = state.doc.lineAt(r.to).number;
      for (let n = a; n <= b; n++) activeLines.add(n);
    }
  }

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
          continue;
        }
        // Image blocks come from imageField: block widgets cannot be provided by a plugin.
        if (spec.kind === "widget" && spec.widget === "image") continue;
        const a = line.from + spec.from;
        const b = line.from + spec.to;
        if (b <= a) continue;
        if (spec.kind === "mark") {
          ranges.push({ from: a, to: b, value: Decoration.mark({ class: spec.class }) });
        } else if (spec.kind === "replace") {
          ranges.push({ from: a, to: b, value: Decoration.replace({}) });
        } else {
          const widget = spec.widget === "bullet" ? bulletWidget : new CheckboxWidget(spec.checked);
          ranges.push({ from: a, to: b, value: Decoration.replace({ widget }) });
        }
      }
    }
  }

  return Decoration.set(ranges, true);
}

function buildImageDecorations(state: EditorState): DecorationSet {
  const fmEnd = frontmatterEndLine(state);
  const activeLines = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) activeLines.add(n);
  }
  const ranges: { from: number; to: number; value: Decoration }[] = [];
  for (let n = fmEnd + 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (!line.text.includes("![")) continue;
    const node = syntaxTree(state).resolveInner(line.from, 1);
    const specs = collectLineDecorations(node, line.from, line.to, line.text, activeLines.has(n));
    for (const spec of specs) {
      if (spec.kind !== "widget" || spec.widget !== "image") continue;
      const src = imageDisplaySrc(spec.src);
      if (!src) continue;
      ranges.push({
        from: line.to,
        to: line.to,
        value: Decoration.widget({ widget: new ImageWidget(src), block: true, side: 1 }),
      });
    }
  }
  return Decoration.set(ranges, true);
}

/** Forces the image field to rebuild (e.g. once attachment URLs become resolvable). */
export const refreshImages = StateEffect.define<null>();

export const imageField = StateField.define<DecorationSet>({
  create: (state) => buildImageDecorations(state),
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(refreshImages)) || syntaxTree(tr.startState) !== syntaxTree(tr.state)
    ) {
      return buildImageDecorations(tr.state);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Obsidian-style live preview extension for markdown documents. */
export function livePreview(): Extension {
  const refresher = ViewPlugin.fromClass(
    class {
      unsubscribe: () => void;
      constructor(view: EditorView) {
        this.unsubscribe = onAttachmentsDirReady(() =>
          view.dispatch({ effects: refreshImages.of(null) }),
        );
      }
      destroy() {
        this.unsubscribe();
      }
    },
  );
  return [imageField, refresher, ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) {
          this.decorations = buildDecorations(u.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  )];
}
