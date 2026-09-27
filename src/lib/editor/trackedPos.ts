import { EditorState, StateEffect, StateField } from "@codemirror/state";

/** Set (or move) tracked position `id`. */
export const setTracked = StateEffect.define<{ id: number; pos: number }>();
export const untrack = StateEffect.define<number>();

/** Positions that follow document edits, e.g. async insert targets. */
export const trackedPositions = StateField.define<ReadonlyMap<number, number>>({
  create: () => new Map(),
  update(value, tr) {
    let next: Map<number, number> | null = null;
    if (tr.docChanged && value.size) {
      next = new Map();
      for (const [id, pos] of value) next.set(id, tr.changes.mapPos(pos, 1));
    }
    for (const e of tr.effects) {
      if (e.is(setTracked)) (next ??= new Map(value)).set(e.value.id, e.value.pos);
      else if (e.is(untrack)) (next ??= new Map(value)).delete(e.value);
    }
    return next ?? value;
  },
});

export function getTracked(state: EditorState, id: number): number | undefined {
  return state.field(trackedPositions, false)?.get(id);
}
