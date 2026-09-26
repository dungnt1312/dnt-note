import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Moon, Plus, Settings, Sun, Monitor, Trash2 } from "lucide-react";
import { api } from "../../lib/api/notes";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";
import { useTheme, type Theme } from "../theme/ThemeProvider";
import { fuzzyRank } from "../../lib/fuzzy";

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

function ThemeActions(runTheme: (t: Theme) => void): PaletteItem[] {
  return [
    { id: "theme-light", label: "Theme: Sáng", icon: <Sun size={15} />, run: () => runTheme("light") },
    { id: "theme-dark", label: "Theme: Tối", icon: <Moon size={15} />, run: () => runTheme("dark") },
    { id: "theme-system", label: "Theme: Theo hệ thống", icon: <Monitor size={15} />, run: () => runTheme("system") },
  ];
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const { setTheme } = useTheme();

  const notes = useNotesStore((s) => s.notes);
  const select = useNotesStore((s) => s.select);
  const create = useNotesStore((s) => s.create);

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  };

  const items: PaletteItem[] = useMemo(() => {
    const actions: PaletteItem[] = [
      {
        id: "act-new",
        label: "Ghi chú mới",
        hint: "Ctrl+N",
        icon: <Plus size={15} />,
        run: () => void create(),
      },
      ...ThemeActions(setTheme),
      {
        id: "act-settings",
        label: "Cài đặt",
        icon: <Settings size={15} />,
        run: () => setSettingsOpen(true),
      },
      {
        id: "act-empty-trash",
        label: "Xóa sạch thùng rác",
        icon: <Trash2 size={15} />,
        run: () => {
          void api.notes.emptyTrash().then((n) => {
            useUi.getState().pushToast({ message: `Đã xóa ${n} ghi chú trong thùng rác`, durationMs: 4000 });
          });
        },
      },
    ];
    const q = query.trim().toLowerCase();
    const matchedActions = fuzzyRank(actions, q, (a) => a.label.toLowerCase()).map((r) => r.item);
    const matchedNotes = fuzzyRank(notes, q, (n) => `${n.title} ${n.snippet}`)
      .slice(0, 8)
      .map<PaletteItem>(({ item: n }) => ({
        id: `note-${n.id}`,
        label: n.title,
        hint: n.snippet.slice(0, 40),
        icon: <FileText size={15} />,
        run: () => void select(n.id),
      }));
    return [...matchedActions, ...matchedNotes];
  }, [query, notes, create, select, setSettingsOpen, setTheme]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const runItem = (item: PaletteItem) => {
    close();
    item.run();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-[12vh]"
      onMouseDown={close}
    >
      <div
        className="w-[560px] max-w-[90vw] rounded-[var(--radius-lg)] bg-[var(--bg-elevated)] border border-[var(--border)] shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const item = items[cursor];
              if (item) runItem(item);
            }
          }}
          placeholder="Tìm ghi chú hoặc lệnh…"
          className="w-full px-4 py-3 text-[14px] bg-transparent outline-none border-b border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-faint)]"
        />
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1.5">
          {items.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-[var(--text-faint)]">
              Không có kết quả
            </div>
          )}
          {items.map((item, i) => (
            <button
              key={item.id}
              data-idx={i}
              onClick={() => runItem(item)}
              onMouseEnter={() => setCursor(i)}
              className={`w-full flex items-center gap-2.5 px-4 py-2 text-left text-[13px] ${
                i === cursor
                  ? "bg-[var(--accent-soft)] text-[var(--text)]"
                  : "text-[var(--text)]"
              }`}
            >
              <span className="text-[var(--text-secondary)]">{item.icon}</span>
              <span className="truncate">{item.label}</span>
              {item.hint && (
                <span className="ml-auto text-[11px] text-[var(--text-faint)] truncate max-w-[200px]">
                  {item.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
