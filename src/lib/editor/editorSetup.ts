import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { livePreview } from "./livePreview";
import { toggleWrap, setHeading, toggleLinePrefix } from "./formatting";

export interface EditorOptions {
  onChange: (body: string) => void;
  onModS?: () => void;
  placeholder?: string;
  onFiles?: (files: File[], pos: number) => void;
}

const formatKeymap = keymap.of([
  { key: "Mod-b", run: (v) => (v.dispatch(toggleWrap(v.state, "**")), true) },
  { key: "Mod-i", run: (v) => (v.dispatch(toggleWrap(v.state, "*")), true) },
  { key: "Mod-e", run: (v) => (v.dispatch(toggleWrap(v.state, "`")), true) },
  { key: "Mod-Shift-x", run: (v) => (v.dispatch(toggleWrap(v.state, "~~")), true) },
  { key: "Mod-Alt-0", run: (v) => (v.dispatch(setHeading(v.state, 0)), true) },
  { key: "Mod-Alt-1", run: (v) => (v.dispatch(setHeading(v.state, 1)), true) },
  { key: "Mod-Alt-2", run: (v) => (v.dispatch(setHeading(v.state, 2)), true) },
  { key: "Mod-Alt-3", run: (v) => (v.dispatch(setHeading(v.state, 3)), true) },
  { key: "Mod-Shift-8", run: (v) => (v.dispatch(toggleLinePrefix(v.state, "bullet")), true) },
  { key: "Mod-Shift-7", run: (v) => (v.dispatch(toggleLinePrefix(v.state, "numbered")), true) },
  { key: "Mod-Shift-9", run: (v) => (v.dispatch(toggleLinePrefix(v.state, "task")), true) },
]);

/** Full extension set for the note body editor. */
export function editorSetup(options: EditorOptions): Extension[] {
  return [
    markdown({ base: markdownLanguage, extensions: GFM }),
    livePreview(),
    history(),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ "aria-label": "Nội dung ghi chú", spellcheck: "false" }),
    placeholderExt(options.placeholder ?? "Bắt đầu viết…"),
    formatKeymap,
    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          options.onModS?.();
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    EditorView.domEventHandlers({
      drop: (e, view) => {
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (!files.length || !options.onFiles) return false;
        e.preventDefault();
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
        options.onFiles(files, pos);
        return true;
      },
      paste: (e, view) => {
        const files = Array.from(e.clipboardData?.files ?? []);
        if (!files.length || !options.onFiles) return false;
        e.preventDefault();
        options.onFiles(files, view.state.selection.main.head);
        return true;
      },
    }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) options.onChange(u.state.doc.toString());
    }),
    editorTheme,
  ];
}

const MONO = "var(--font-mono)";

const editorTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--studio-fg)", fontSize: "15px" },
  ".cm-content": {
    caretColor: "var(--studio-fg)",
    fontFamily: "var(--font-sans)",
    padding: "4px 0 40vh 0",
  },
  ".cm-line": { padding: "0" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--studio-fg)", borderLeftWidth: "1.5px" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.75" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--studio-fg) 16%, transparent) !important",
  },
  ".cm-placeholder": { color: "var(--studio-fg-tertiary)" },

  // Obsidian-style live preview classes
  ".cm-frontmatter": {
    color: "var(--studio-fg-tertiary)",
    fontFamily: MONO,
    fontSize: "12px",
  },
  ".cm-h1": { fontSize: "28px", fontWeight: "700", lineHeight: "1.3", paddingTop: "14px" },
  ".cm-h2": { fontSize: "22px", fontWeight: "600", lineHeight: "1.35", paddingTop: "12px" },
  ".cm-h3": { fontSize: "17px", fontWeight: "600", lineHeight: "1.4", paddingTop: "8px" },
  ".cm-h4": { fontSize: "15px", fontWeight: "600" },
  ".cm-bold": { fontWeight: "700" },
  ".cm-em": { fontStyle: "italic" },
  ".cm-strike": { textDecoration: "line-through", color: "var(--studio-fg-tertiary)" },
  ".cm-code": {
    fontFamily: MONO,
    fontSize: "13px",
    backgroundColor: "var(--studio-subtle)",
    border: "1px solid var(--studio-hairline)",
    borderRadius: "5px",
    padding: "1px 4px",
  },
  ".cm-code-block": {
    fontFamily: MONO,
    fontSize: "13px",
    lineHeight: "1.65",
    backgroundColor: "var(--studio-subtle)",
    borderLeft: "1px solid var(--studio-hairline)",
    borderRight: "1px solid var(--studio-hairline)",
    padding: "0 14px !important",
  },
  ".cm-code-block-begin": {
    borderTop: "1px solid var(--studio-hairline)",
    borderTopLeftRadius: "8px",
    borderTopRightRadius: "8px",
    paddingTop: "8px !important",
    color: "var(--studio-fg-tertiary)",
  },
  ".cm-code-block-end": {
    borderBottom: "1px solid var(--studio-hairline)",
    borderBottomLeftRadius: "8px",
    borderBottomRightRadius: "8px",
    paddingBottom: "8px !important",
    color: "var(--studio-fg-tertiary)",
  },
  ".cm-table": { fontFamily: MONO, fontSize: "13px", color: "var(--studio-fg-secondary)" },
  ".cm-quote": {
    borderLeft: "3px solid var(--studio-hairline)",
    paddingLeft: "14px !important",
    color: "var(--studio-fg-secondary)",
  },
  ".cm-hr": { color: "var(--studio-fg-tertiary)" },
  ".cm-bullet": {
    display: "inline-block",
    width: "1.3em",
    color: "var(--studio-fg-tertiary)",
    textAlign: "center",
  },
  ".cm-list-number": { color: "var(--studio-fg-tertiary)", fontVariantNumeric: "tabular-nums" },
  ".cm-checkbox": {
    display: "inline-flex",
    alignItems: "center",
    marginRight: "6px",
    verticalAlign: "-2px",
  },
  ".cm-checkbox input": {
    accentColor: "var(--studio-fg)",
    width: "15px",
    height: "15px",
    margin: "0",
    cursor: "pointer",
  },
});

export function createEditorState(doc: string, options: EditorOptions): EditorState {
  return EditorState.create({ doc, extensions: editorSetup(options) });
}
