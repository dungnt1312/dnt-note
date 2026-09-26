import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { livePreview } from "./livePreview";

export interface EditorOptions {
  onChange: (body: string) => void;
  onModS?: () => void;
}

/** Full extension set for the note body editor. */
export function editorSetup(options: EditorOptions): Extension[] {
  return [
    markdown({ base: markdownLanguage, extensions: GFM }),
    livePreview(),
    history(),
    EditorView.lineWrapping,
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
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) options.onChange(u.state.doc.toString());
    }),
    editorTheme,
  ];
}

const editorTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--text)", fontSize: "15px" },
  ".cm-content": {
    caretColor: "var(--accent)",
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    padding: "8px 0 40vh 0",
  },
  ".cm-line": { padding: "0 4px" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.7" },

  // Obsidian-style live preview classes
  ".cm-frontmatter": {
    color: "var(--text-faint)",
    backgroundColor: "var(--bg-panel)",
    fontSize: "12px",
  },
  ".cm-h1": { fontSize: "1.87em", fontWeight: "700", lineHeight: "1.3" },
  ".cm-h2": { fontSize: "1.56em", fontWeight: "700", lineHeight: "1.3" },
  ".cm-h3": { fontSize: "1.31em", fontWeight: "600", lineHeight: "1.3" },
  ".cm-h4": { fontSize: "1.15em", fontWeight: "600", lineHeight: "1.3" },
  ".cm-bold": { fontWeight: "700" },
  ".cm-em": { fontStyle: "italic" },
  ".cm-strike": { textDecoration: "line-through", color: "var(--text-secondary)" },
  ".cm-code": {
    fontFamily: '"Cascadia Code", Consolas, monospace',
    fontSize: "0.9em",
    backgroundColor: "var(--code-bg)",
    borderRadius: "4px",
    padding: "1px 3px",
  },
  ".cm-code-block": {
    fontFamily: '"Cascadia Code", Consolas, monospace',
    fontSize: "0.9em",
    backgroundColor: "var(--code-bg)",
    borderRadius: "var(--radius-sm)",
  },
  ".cm-table": {
    fontFamily: '"Cascadia Code", Consolas, monospace',
    fontSize: "0.92em",
  },
  ".cm-checkbox": {
    display: "inline-flex",
    alignItems: "center",
    marginRight: "2px",
  },
  ".cm-checkbox input": {
    accentColor: "var(--accent)",
    width: "15px",
    height: "15px",
    cursor: "pointer",
  },
});

export function createEditorState(doc: string, options: EditorOptions): EditorState {
  return EditorState.create({ doc, extensions: editorSetup(options) });
}
