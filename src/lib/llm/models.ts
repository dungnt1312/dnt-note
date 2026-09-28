/** Trim names, drop blanks and duplicates (first occurrence wins). */
export function cleanModelList(models: string[]): string[] {
  const out: string[] = [];
  for (const raw of models) {
    const m = raw.trim();
    if (m && !out.includes(m)) out.push(m);
  }
  return out;
}

const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Saved models first (their own order), then the not-yet-saved fetched ones, gpt-4o before gpt-10. */
export function mergeModelLists(saved: string[], fetched: string[]): string[] {
  const keep = cleanModelList(saved);
  const rest = cleanModelList(fetched)
    .filter((m) => !keep.includes(m))
    .sort(naturalOrder.compare);
  return [...keep, ...rest];
}
