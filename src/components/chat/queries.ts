/** Detects an active @mention query right before the caret. */
export function mentionQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const m = /(?:^|\s)@([^\s@]*)$/.exec(before);
  return m ? m[1] : null;
}

/** Detects an active /skill query right before the caret. */
export function slashQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const m = /(?:^|\s)\/([^\s/]*)$/.exec(before);
  return m ? m[1] : null;
}

/** Enabled, not-yet-picked skills whose name starts with the query (case-insensitive). */
export function matchSkills<T extends { name: string; enabled: boolean }>(
  skills: T[],
  query: string,
  exclude: string[] = [],
): T[] {
  const q = query.toLowerCase();
  return skills
    .filter((s) => s.enabled && !exclude.includes(s.name) && s.name.toLowerCase().startsWith(q))
    .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
}
