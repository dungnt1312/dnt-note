import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { getTracked, setTracked, trackedPositions, untrack } from "./trackedPos";

describe("trackedPositions", () => {
  it("maps tracked positions through edits", () => {
    let s = EditorState.create({ doc: "hello world", extensions: trackedPositions });
    s = s.update({ effects: setTracked.of({ id: 1, pos: 6 }) }).state;
    s = s.update({ changes: { from: 0, insert: "XX" } }).state;
    expect(getTracked(s, 1)).toBe(8);
    s = s.update({ changes: { from: 9, to: 11 } }).state;
    expect(getTracked(s, 1)).toBe(8);
    s = s.update({ changes: { from: 0, to: 10 } }).state;
    expect(getTracked(s, 1)).toBe(0);
    s = s.update({ effects: untrack.of(1) }).state;
    expect(getTracked(s, 1)).toBeUndefined();
  });
});
