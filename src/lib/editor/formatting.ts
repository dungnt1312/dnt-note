import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Toggle an inline marker (`**`, `*`, `~~`, `` ` ``) around the main selection. */
export function toggleWrap(state: EditorState, mark: string): TransactionSpec {
  const { from, to } = state.selection.main;
  const n = mark.length;
  const before = state.sliceDoc(Math.max(0, from - n), from);
  const after = state.sliceDoc(to, to + n);
  if (before === mark && after === mark) {
    return {
      changes: [
        { from: from - n, to: from },
        { from: to, to: to + n },
      ],
      selection: EditorSelection.single(from - n, to - n),
    };
  }
  const inner = state.sliceDoc(from, to);
  if (inner.length > 2 * n && inner.startsWith(mark) && inner.endsWith(mark)) {
    return {
      changes: { from, to, insert: inner.slice(n, -n) },
      selection: EditorSelection.single(from, to - 2 * n),
    };
  }
  return {
    changes: [
      { from, insert: mark },
      { from: to, insert: mark },
    ],
    selection: EditorSelection.single(from + n, to + n),
  };
}

function selectedLines(state: EditorState) {
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from).number;
  // A selection ending at column 0 of a line does not include that line.
  const endLine = state.doc.lineAt(to);
  const last = to > from && endLine.from === to ? endLine.number - 1 : endLine.number;
  const lines = [];
  for (let n = first; n <= Math.max(first, last); n++) lines.push(state.doc.line(n));
  return lines;
}

const HEADING = /^#{1,6}\s+/;

/** Set heading level 1–6 on the selected lines; 0 turns them into paragraphs. */
export function setHeading(state: EditorState, level: number): TransactionSpec {
  const prefix = level > 0 ? `${"#".repeat(level)} ` : "";
  return {
    changes: selectedLines(state).map((line) => {
      const existing = HEADING.exec(line.text)?.[0] ?? "";
      return { from: line.from, to: line.from + existing.length, insert: prefix };
    }),
  };
}

export type LinePrefix = "bullet" | "numbered" | "task" | "quote";

const LIST_PREFIX = /^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/;
const MATCH: Record<LinePrefix, RegExp> = {
  bullet: /^(\s*)[-*+]\s+(?!\[[ xX]\])/,
  numbered: /^(\s*)\d+[.)]\s+/,
  task: /^(\s*)[-*+]\s+\[[ xX]\]\s+/,
  quote: /^(\s*)>\s?/,
};

/** Toggle a block prefix on every selected line (lists replace each other). */
export function toggleLinePrefix(state: EditorState, kind: LinePrefix): TransactionSpec {
  const lines = selectedLines(state).filter((l, _i, all) => all.length === 1 || l.text.trim() !== "");
  const allHave = lines.every((l) => MATCH[kind].test(l.text));
  const changes = lines.map((line, i) => {
    const strip = kind === "quote" ? MATCH.quote : LIST_PREFIX;
    const current = strip.exec(line.text);
    const indent = current?.[1] ?? /^\s*/.exec(line.text)![0];
    const removeLen = current ? current[0].length : indent.length;
    if (allHave) return { from: line.from, to: line.from + removeLen, insert: indent };
    const insert =
      kind === "bullet" ? "- " : kind === "numbered" ? `${i + 1}. ` : kind === "task" ? "- [ ] " : "> ";
    return { from: line.from, to: line.from + removeLen, insert: indent + insert };
  });
  return { changes };
}

/** Insert a block (fenced code, table, rule) on fresh lines after the cursor line. */
export function insertBlock(state: EditorState, kind: "code" | "table" | "rule"): TransactionSpec {
  const line = state.doc.lineAt(state.selection.main.head);
  const lead = line.text.trim() === "" ? "" : "\n";
  const body =
    kind === "code"
      ? "```\n\n```\n"
      : kind === "table"
        ? "| Cột 1 | Cột 2 |\n| --- | --- |\n|  |  |\n"
        : "---\n";
  const insert = lead + body;
  const at = line.text.trim() === "" ? line.from : line.to;
  const caret = kind === "code" ? at + lead.length + 4 : at + insert.length;
  return {
    changes: { from: at, to: line.text.trim() === "" ? line.to : at, insert },
    selection: EditorSelection.cursor(caret),
  };
}

/** Wrap the selection as `[text](https://)` and select the URL part. */
export function insertLink(state: EditorState): TransactionSpec {
  const { from, to } = state.selection.main;
  const text = state.sliceDoc(from, to) || "liên kết";
  const insert = `[${text}](https://)`;
  const urlFrom = from + text.length + 3;
  return {
    changes: { from, to, insert },
    selection: EditorSelection.single(urlFrom, urlFrom + "https://".length),
  };
}

/** Run a formatting command against a live view and keep focus in the editor. */
export function applyFormat(view: EditorView | null, build: (s: EditorState) => TransactionSpec): void {
  if (!view) return;
  view.dispatch(build(view.state));
  view.focus();
}
