import { FileText, MoreHorizontal, Pin, PinOff, Trash2 } from "lucide-react";
import type { NoteMeta } from "../../lib/api/notes";
import { shortDate } from "../../lib/dates";
import { SidebarRow } from "../layout/SidebarRow";
import { Menu, MenuItem, MenuSeparator } from "../ui/Menu";

interface NoteItemProps {
  note: NoteMeta;
  selected: boolean;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  onTogglePin?: (id: string, pinned: boolean) => void;
}

/** Compact ChatGPT-style row: icon + title, then "date · snippet" on one line. */
export function NoteItem({ note, selected, onSelect, onDelete, onTogglePin }: NoteItemProps) {
  const hasActions = Boolean(onDelete || onTogglePin);
  return (
    <SidebarRow
      selected={selected}
      onSelect={() => onSelect(note.id)}
      actions={
        hasActions ? (
          <Menu
            width={200}
            trigger={(p) => (
              <button
                type="button"
                {...p}
                aria-label={`Tùy chọn cho “${note.title}”`}
                title="Tùy chọn"
                className="flex size-7 items-center justify-center rounded-sm text-fg-secondary hover:bg-selected hover:text-fg"
              >
                <MoreHorizontal size={15} aria-hidden="true" />
              </button>
            )}
          >
            {onTogglePin && (
              <MenuItem
                icon={note.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                onSelect={() => onTogglePin(note.id, !note.pinned)}
              >
                {note.pinned ? "Bỏ ghim" : "Ghim lên đầu"}
              </MenuItem>
            )}
            {onTogglePin && onDelete && <MenuSeparator />}
            {onDelete && (
              <MenuItem destructive icon={<Trash2 size={14} />} onSelect={() => onDelete(note.id)}>
                Xóa ghi chú
              </MenuItem>
            )}
          </Menu>
        ) : undefined
      }
    >
      <div className="flex items-center gap-1.5 pr-6">
        <FileText size={12} aria-hidden="true" className="shrink-0 text-fg-tertiary" />
        <span className="min-w-0 flex-1 truncate text-callout font-medium text-fg">
          {note.title || "Chưa đặt tên"}
        </span>
        {note.pinned && (
          <Pin size={11} aria-label="Đã ghim" className="shrink-0 fill-current text-fg-tertiary" />
        )}
      </div>
      <div className="mt-0.5 flex min-w-0 gap-1.5 pl-[18px] text-footnote">
        <span className="shrink-0 text-fg-secondary">{shortDate(note.updated)}</span>
        <span className="truncate text-fg-tertiary">{note.snippet || "Chưa có nội dung"}</span>
      </div>
    </SidebarRow>
  );
}
