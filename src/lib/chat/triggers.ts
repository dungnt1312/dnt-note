/**
 * Composer trigger detection. `@` opens the note-mention popover; the same
 * shape will serve `/` (skills) later — one helper, one rule.
 *
 * The trigger fires unless `@` is glued to a word character, so `user@host`
 * and `x_@y` stay quiet while `(@note`, `— @note`, text-start and
 * space-prefixed mentions all fire. The query ends at whitespace or `@`.
 */
export function activeTriggerQuery(textBeforeCaret: string): string | null {
  const m = /(?:^|[^A-Za-z0-9_])@([^\s@]*)$/.exec(textBeforeCaret);
  return m ? m[1] : null;
}
