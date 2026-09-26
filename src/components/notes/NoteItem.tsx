import { Pin, Trash2 } from "lucide-react";
import { cn } from "../../lib/utils";
import type { NoteMeta } from "../../lib/api/notes";
import { dateLabel } from "./NoteList";

interface NoteItemProps {
  note: NoteMeta;
  selected: boolean;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  showPin?: boolean;
}

export function NoteItem({ note, selected, onSelect, onDelete, showPin }: NoteItemProps) {
  return (
    <div
      role="button"
      onClick={() => onSelect(note.id)}
      className={cn(
        "group w-full text-left px-3 py-2.5 rounded-[var(--radius-md)] mb-0.5 transition-colors cursor-pointer",
        "hover:bg-[var(--bg-hover)]",
        selected ? "bg-[var(--accent-soft)]" : "bg-transparent",
      )}
    >
      <div className="flex items-center gap-1.5">
        {note.pinned && showPin && (
          <span className="text-[var(--accent)] shrink-0">
            <Pin size={12} strokeWidth={2.5} />
          </span>
        )}
        <span className="flex-1 truncate text-[14px] font-medium text-[var(--text)]">
          {note.title}
        </span>
        <span className="text-[11px] text-[var(--text-faint)] shrink-0 group-hover:hidden">
          {dateLabel(note.updated)}
        </span>
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(note.id);
            }}
            title="Xóa ghi chú"
            className="hidden group-hover:flex text-[var(--text-faint)] hover:text-[var(--danger)] shrink-0"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <div className="mt-0.5 text-[12px] text-[var(--text-secondary)] truncate">
        {note.snippet || "—"}
      </div>
      {note.tags.length > 0 && (
        <div className="mt-1 flex gap-1 flex-wrap">
          {note.tags.map((t) => (
            <span
              key={t}
              className="text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--bg-hover)] text-[var(--text-secondary)]"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
