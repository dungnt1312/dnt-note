import { Plus, Search } from "lucide-react";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";
import { cn } from "../../lib/utils";
import { NoteList } from "../notes/NoteList";

export function Sidebar() {
  const notes = useNotesStore((s) => s.notes);
  const tags = useNotesStore((s) => s.tags);
  const selectedId = useNotesStore((s) => s.selectedId);
  const select = useNotesStore((s) => s.select);
  const create = useNotesStore((s) => s.create);

  const searchQuery = useUi((s) => s.searchQuery);
  const setSearchQuery = useUi((s) => s.setSearchQuery);
  const tagFilter = useUi((s) => s.tagFilter);
  const setTagFilter = useUi((s) => s.setTagFilter);

  const visible = tagFilter ? notes.filter((n) => n.tags.includes(tagFilter)) : notes;

  return (
    <aside className="w-[280px] shrink-0 flex flex-col border-r border-[var(--border)] bg-[var(--bg-panel)]">
      <div className="p-3 flex flex-col gap-2">
        <button
          onClick={() => void create()}
          className="flex items-center justify-center gap-2 py-2 rounded-[var(--radius-md)] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-90"
        >
          <Plus size={15} /> Ghi chú mới
          <kbd className="text-[10px] opacity-70">Ctrl N</kbd>
        </button>
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
          />
          <input
            id="note-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm trong ghi chú…"
            className="w-full pl-8 pr-2 py-1.5 text-[13px] rounded-[var(--radius-md)] bg-[var(--bg-elevated)] border border-[var(--border)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-faint)]"
          />
        </div>
        {tags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {tags.map(({ name, count }) => (
              <button
                key={name}
                onClick={() => setTagFilter(tagFilter === name ? null : name)}
                className={cn(
                  "text-[11px] px-2 py-0.5 rounded-full border",
                  tagFilter === name
                    ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)]",
                )}
              >
                {name} · {count}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <NoteList
          notes={visible}
          selectedId={selectedId}
          onSelect={(id) => void select(id)}
          query={searchQuery}
        />
      </div>
    </aside>
  );
}
