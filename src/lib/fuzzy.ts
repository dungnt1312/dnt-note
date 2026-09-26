/**
 * Subsequence fuzzy match with scoring. Higher score = better match, null = no
 * match. Bonus for: exact substring, consecutive runs, word-start hits.
 */
export function fuzzyMatch(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();

  const substring = t.indexOf(q);
  if (substring >= 0) {
    // Exact substring: base high + earlier-position bonus + word-start bonus.
    let score = 100 + q.length * 4 - Math.min(substring, 20);
    if (substring === 0 || /[\s\-_/]/.test(t[substring - 1] ?? "")) score += 20;
    return score;
  }

  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    streak = found === ti ? streak + 1 : 0;
    score += 2 + streak * 2;
    if (found === 0 || /[\s\-_/]/.test(t[found - 1] ?? "")) score += 6;
    ti = found + 1;
  }
  return score;
}

/** Rank items by fuzzy score (desc). Non-matching items are dropped.
 *  Default text source: `item.text` when present, else String(item). */
export function fuzzyRank<T>(
  items: T[],
  query: string,
  textOf: (item: T) => string = (item) =>
    typeof item === "object" && item !== null && "text" in item
      ? String((item as { text: unknown }).text)
      : String(item),
): { item: T; score: number }[] {
  const q = query.trim();
  if (!q) return items.map((item) => ({ item, score: 0 }));
  const ranked: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = fuzzyMatch(q, textOf(item));
    if (score !== null) ranked.push({ item, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}
