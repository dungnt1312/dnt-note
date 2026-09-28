import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { getSelectionInfo } from "./selection";

const stateOf = (doc: string, anchor: number, head: number) =>
  EditorState.create({ doc, selection: { anchor, head } });

describe("getSelectionInfo", () => {
  it("collapsed caret → hasSelection false, empty text", () => {
    const info = getSelectionInfo(stateOf("hello world", 3, 3));
    expect(info).toEqual({ from: 3, to: 3, text: "", hasSelection: false });
  });

  it("returns the selected text", () => {
    const info = getSelectionInfo(stateOf("hello world", 0, 5));
    expect(info).toEqual({ from: 0, to: 5, text: "hello", hasSelection: true });
  });

  it("normalizes a reversed selection (head before anchor)", () => {
    const info = getSelectionInfo(stateOf("hello world", 5, 0));
    expect(info).toEqual({ from: 0, to: 5, text: "hello", hasSelection: true });
  });
});
