import { filterNotes } from "../../lib/filterNotes";
import { groupByTime } from "../../lib/dates";
import type { NoteMeta } from "../../lib/api/notes";
import { NoteItem } from "./NoteItem";
import { SidebarSectionLabel } from "../layout/SidebarRow";

interface NoteListProps {
  notes: NoteMeta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  onTogglePin?: (id: string, pinned: boolean) => void;
  query?: string;
}

/** Pinned first, then the rest grouped by last edit (Hôm nay / Hôm qua / 7 ngày qua…). */
export function NoteList({ notes, selectedId, onSelect, onDelete, onTogglePin, query = "" }: NoteListProps) {
  const visible = filterNotes(notes, query);

  if (visible.length === 0) {
    return (
      <p className="px-3 pt-10 text-center text-callout text-fg-secondary">
        {query ? "Không tìm thấy ghi chú phù hợp" : "Chưa có ghi chú nào"}
      </p>
    );
  }

  const pinned = visible.filter((n) => n.pinned);
  const groups = [
    ...(pinned.length ? [{ key: "pinned", label: "Đã ghim", items: pinned }] : []),
    ...groupByTime(
      visible.filter((n) => !n.pinned),
      (n) => n.updated,
    ),
  ];

  const renderItem = (n: NoteMeta) => (
    <li key={n.id}>
      <NoteItem
        note={n}
        selected={n.id === selectedId}
        onSelect={onSelect}
        onDelete={onDelete}
        onTogglePin={onTogglePin}
      />
    </li>
  );

  return (
    <div className="flex flex-col">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label}>
          <SidebarSectionLabel>{g.label}</SidebarSectionLabel>
          <ul className="flex flex-col gap-px">{g.items.map(renderItem)}</ul>
        </section>
      ))}
    </div>
  );
}
