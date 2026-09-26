import type { NoteMeta } from "./api/notes";

/** Client-side filter over title + snippet, case-insensitive, order-preserving. */
export function filterNotes(notes: NoteMeta[], query: string): NoteMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  return notes.filter(
    (n) => n.title.toLowerCase().includes(q) || n.snippet.toLowerCase().includes(q),
  );
}
