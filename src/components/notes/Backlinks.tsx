import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { api, type NoteMeta } from "../../lib/api/notes";
import { useNotesStore } from "../../lib/store/notesStore";
import { isTauri } from "../../lib/env";

/** "Liên kết ngược" list under the editor; refreshes when the note list changes. */
export function Backlinks({ noteId }: { noteId: string }) {
  const notes = useNotesStore((s) => s.notes);
  const select = useNotesStore((s) => s.select);
  const [items, setItems] = useState<NoteMeta[]>([]);

  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    api.notes
      .backlinks(noteId)
      .then((r) => alive && setItems(r))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [noteId, notes]);

  return (
    <section aria-label="Liên kết ngược" className="mb-16 mt-6 border-t border-hairline pt-4">
      {items.length === 0 ? (
        <p className="text-footnote text-fg-tertiary">Không có liên kết ngược</p>
      ) : (
        <>
          <h3 className="mb-2 flex items-center gap-1.5 text-footnote font-semibold text-fg-secondary">
            <Link2 size={13} aria-hidden="true" />
            Liên kết ngược ({items.length})
          </h3>
          <ul className="flex flex-col gap-1">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => void select(n.id)}
                  className="w-full rounded-md px-2 py-1.5 text-left hover:bg-hover"
                >
                  <div className="truncate text-callout font-medium text-fg">{n.title || "Chưa đặt tên"}</div>
                  {n.snippet && <div className="truncate text-footnote text-fg-tertiary">{n.snippet}</div>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
