import { filterNotes } from "../../lib/filterNotes";
import type { NoteMeta } from "../../lib/api/notes";
import { NoteItem } from "./NoteItem";

interface NoteListProps {
  notes: NoteMeta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  query?: string;
}

export function NoteList({ notes, selectedId, onSelect, onDelete, query = "" }: NoteListProps) {
  const visible = filterNotes(notes, query);
  const pinned = visible.filter((n) => n.pinned);
  const rest = visible.filter((n) => !n.pinned);

  if (visible.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-[var(--text-faint)] text-[13px]">
        Không có ghi chú nào
      </div>
    );
  }

  const group = (label: string, items: NoteMeta[], showPin: boolean) => (
    <>
      {items.length > 0 && (
        <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
          {label}
        </div>
      )}
      {items.map((n) => (
        <NoteItem
          key={n.id}
          note={n}
          selected={n.id === selectedId}
          onSelect={onSelect}
          onDelete={onDelete}
          showPin={showPin}
        />
      ))}
    </>
  );

  return (
    <div className="px-2 pb-4" role="list">
      {group("Pinned", pinned, true)}
      {group("Tất cả", rest, false)}
    </div>
  );
}

export function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}
