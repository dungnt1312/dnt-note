import type { EditorState } from "@codemirror/state";

export interface SelectionInfo {
  from: number;
  to: number;
  text: string;
  hasSelection: boolean;
}

/** Selection snapshot of the note editor at right-click time. */
export function getSelectionInfo(state: EditorState): SelectionInfo {
  const range = state.selection.main;
  return {
    from: range.from,
    to: range.to,
    text: state.sliceDoc(range.from, range.to),
    hasSelection: !range.empty,
  };
}
