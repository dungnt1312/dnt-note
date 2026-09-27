import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FileText,
  Loader2,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeft,
  Search,
  ScanSearch,
  Settings,
  Sparkles,
  SquarePen,
  Sun,
  Trash2,
} from "lucide-react";
import { api } from "../../lib/api/notes";
import { useNotesStore } from "../../lib/store/notesStore";
import { useChatStore } from "../../lib/store/chatStore";
import { useUi } from "../../lib/store/uiStore";
import { useTheme } from "../theme/ThemeProvider";
import { INDEXING_DISABLED, semanticSearch, type SemanticResult } from "../../lib/semantic";
import { useSettingsStore } from "../../lib/store/settingsStore";
import { fuzzyRank } from "../../lib/fuzzy";
import { shortDate } from "../../lib/dates";
import { cn } from "../../lib/utils";
import { Keycap } from "../ui/Button";
import { ConfirmDialog, Overlay } from "../ui/Dialog";

interface PaletteItem {
  id: string;
  group: "Lệnh" | "Ghi chú gần đây" | "Ghi chú" | "Hội thoại" | "Theo ý nghĩa";
  label: string;
  detail?: string;
  shortcut?: string;
  icon: ReactNode;
  run: () => void;
  /** Keep the palette open after running (mode switches). */
  keepOpen?: boolean;
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const setSection = useUi((s) => s.setSection);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const setChatOpen = useUi((s) => s.setChatOpen);
  const pushToast = useUi((s) => s.pushToast);
  const { setTheme } = useTheme();

  const notes = useNotesStore((s) => s.notes);
  const select = useNotesStore((s) => s.select);
  const create = useNotesStore((s) => s.create);
  const sessions = useChatStore((s) => s.sessions);
  const loadChat = useChatStore((s) => s.loadChat);
  const newChat = useChatStore((s) => s.newChat);

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [semantic, setSemantic] = useState<{ loading: boolean; error: string | null; results: SemanticResult[] }>({
    loading: false,
    error: null,
    results: [],
  });
  const semanticEnabled = useSettingsStore((s) => s.semanticIndexing);
  const semanticMode = query.startsWith("?");
  const semanticQuery = semanticMode ? query.slice(1).trim() : "";

  useEffect(() => {
    if (!semanticMode || !semanticQuery || !semanticEnabled) {
      setSemantic({ loading: false, error: null, results: [] });
      return;
    }
    let cancelled = false;
    setSemantic((s) => ({ ...s, loading: true, error: null }));
    const t = setTimeout(() => {
      semanticSearch(semanticQuery)
        .then((results) => !cancelled && setSemantic({ loading: false, error: null, results }))
        .catch((e) => !cancelled && setSemantic({ loading: false, error: e instanceof Error ? e.message : String(e), results: [] }));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [semanticMode, semanticQuery, semanticEnabled]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  };

  const items = useMemo(() => {
    if (semanticMode) {
      return semantic.results.map<PaletteItem>((r) => ({
        id: `sem-${r.id}`,
        group: "Theo ý nghĩa",
        label: r.title || "Chưa đặt tên",
        detail: `${Math.round(r.score * 100)}%`,
        icon: <FileText size={15} />,
        run: () => {
          setSection("notes");
          void select(r.id);
        },
      }));
    }
    const commands: PaletteItem[] = [
      { id: "new-note", group: "Lệnh", label: "Ghi chú mới", shortcut: "Ctrl N", icon: <SquarePen size={15} />, run: () => {
        setSection("notes");
        void create();
      } },
      { id: "new-chat", group: "Lệnh", label: "Hội thoại mới", shortcut: "Ctrl ⇧ O", icon: <MessageSquare size={15} />, run: () => {
        void newChat();
        setSection("chat");
      } },
      { id: "semantic", group: "Lệnh", label: "Tìm theo ý nghĩa…", detail: "gõ ? trước", icon: <ScanSearch size={15} />, keepOpen: true, run: () => setQuery("?") },
      { id: "go-notes", group: "Lệnh", label: "Đi tới Ghi chú", shortcut: "Ctrl 1", icon: <FileText size={15} />, run: () => setSection("notes") },
      { id: "go-chat", group: "Lệnh", label: "Đi tới Trợ lý AI", shortcut: "Ctrl 2", icon: <Sparkles size={15} />, run: () => setSection("chat") },
      { id: "side-chat", group: "Lệnh", label: "Mở trợ lý cạnh ghi chú", shortcut: "Ctrl ⇧ J", icon: <Sparkles size={15} />, run: () => {
        setSection("notes");
        setChatOpen(true);
      } },
      { id: "sidebar", group: "Lệnh", label: "Ẩn/hiện thanh bên", shortcut: "Ctrl \\", icon: <PanelLeft size={15} />, run: toggleSidebar },
      { id: "theme-light", group: "Lệnh", label: "Giao diện: Sáng", icon: <Sun size={15} />, run: () => setTheme("light") },
      { id: "theme-dark", group: "Lệnh", label: "Giao diện: Tối", icon: <Moon size={15} />, run: () => setTheme("dark") },
      { id: "theme-system", group: "Lệnh", label: "Giao diện: Theo hệ thống", icon: <Monitor size={15} />, run: () => setTheme("system") },
      { id: "settings", group: "Lệnh", label: "Cài đặt", shortcut: "Ctrl ,", icon: <Settings size={15} />, run: () => setSection("settings") },
      { id: "empty-trash", group: "Lệnh", label: "Dọn sạch thùng rác…", icon: <Trash2 size={15} />, run: () => setConfirmTrash(true) },
    ];
    const q = query.trim().toLowerCase();
    const cmd = fuzzyRank(commands, q, (c) => c.label.toLowerCase()).map((r) => r.item);
    const noteItems = fuzzyRank(notes, q, (n) => `${n.title} ${n.snippet}`)
      .slice(0, q ? 8 : 5)
      .map<PaletteItem>(({ item: n }) => ({
        id: `note-${n.id}`,
        group: q ? "Ghi chú" : "Ghi chú gần đây",
        label: n.title || "Chưa đặt tên",
        detail: shortDate(n.updated),
        icon: <FileText size={15} />,
        run: () => {
          setSection("notes");
          void select(n.id);
        },
      }));
    const chatItems = (q ? fuzzyRank(sessions, q, (s) => s.title).map((r) => r.item) : sessions.slice(0, 3))
      .slice(0, 5)
      .map<PaletteItem>((s) => ({
        id: `chat-${s.id}`,
        group: "Hội thoại",
        label: s.title,
        detail: shortDate(s.updated),
        icon: <MessageSquare size={15} />,
        run: () => {
          void loadChat(s.id);
          setSection("chat");
        },
      }));
    return [...cmd, ...noteItems, ...chatItems];
  }, [semanticMode, semantic.results, query, notes, sessions, create, newChat, select, loadChat, setSection, setChatOpen, toggleSidebar, setTheme]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const runItem = (item: PaletteItem) => {
    if (item.keepOpen) {
      item.run();
      return;
    }
    close();
    item.run();
  };

  let lastGroup = "";

  return (
    <>
      <Overlay open={open} onClose={close} label="Bảng lệnh" placement="top" className="w-[600px]">
        <div className="flex h-[52px] items-center gap-2.5 px-4">
          <Search size={16} aria-hidden="true" className="shrink-0 text-fg-tertiary" />
          <input
            data-autofocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
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
            placeholder="Tìm ghi chú, hội thoại hoặc lệnh… (? để tìm theo ý nghĩa)"
            aria-label="Tìm ghi chú, hội thoại hoặc lệnh"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[cursor] ? `pal-${items[cursor].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-body text-fg outline-none"
          />
          <Keycap>Esc</Keycap>
        </div>
        <div className="h-px bg-hairline" />
        <div ref={listRef} id="palette-list" role="listbox" className="max-h-[380px] overflow-y-auto p-1.5">
          {semanticMode && !semanticEnabled && (
            <p role="alert" className="px-3 py-7 text-center text-callout text-fg-secondary">{INDEXING_DISABLED}</p>
          )}
          {semanticMode && semanticEnabled && semantic.loading && (
            <p className="flex items-center justify-center gap-2 py-7 text-callout text-fg-secondary">
              <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Đang tìm theo ý nghĩa…
            </p>
          )}
          {semanticMode && semanticEnabled && !semantic.loading && semantic.error && (
            <p role="alert" className="px-3 py-7 text-center text-callout text-fg-secondary">{semantic.error}</p>
          )}
          {semanticMode && semanticEnabled && !semantic.loading && !semantic.error && !semanticQuery && (
            <p className="py-7 text-center text-callout text-fg-secondary">Nhập mô tả nội dung cần tìm sau dấu “?”</p>
          )}
          {semanticMode && semanticEnabled && !semantic.loading && !semantic.error && semanticQuery && items.length === 0 && (
            <p className="py-7 text-center text-callout text-fg-secondary">Không có kết quả</p>
          )}
          {!semanticMode && items.length === 0 && (
            <p className="py-7 text-center text-callout text-fg-secondary">Không có kết quả cho “{query}”</p>
          )}
          {items.map((item, i) => {
            const header = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header && (
                  <div role="presentation" className="px-2.5 pb-1 pt-2.5 text-footnote font-semibold text-fg-secondary">
                    {item.group}
                  </div>
                )}
                <button
                  type="button"
                  id={`pal-${item.id}`}
                  role="option"
                  aria-selected={i === cursor}
                  data-idx={i}
                  tabIndex={-1}
                  onClick={() => runItem(item)}
                  onMouseMove={() => setCursor(i)}
                  className={cn(
                    "flex h-9 w-full items-center gap-2.5 rounded-sm px-2.5 text-left",
                    i === cursor && "bg-hover",
                  )}
                >
                  <span aria-hidden="true" className={cn("flex w-[18px] justify-center", i === cursor ? "text-fg" : "text-fg-secondary")}>
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-callout font-medium text-fg">{item.label}</span>
                  {item.detail && <span className="shrink-0 text-footnote text-fg-tertiary">{item.detail}</span>}
                  {item.shortcut && <Keycap>{item.shortcut}</Keycap>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="h-px bg-hairline" />
        <div className="flex h-[34px] items-center gap-4 px-3.5 text-caption text-fg-tertiary">
          <span className="flex items-center gap-1.5">
            <Keycap>↑↓</Keycap> di chuyển
          </span>
          <span className="flex items-center gap-1.5">
            <Keycap>↵</Keycap> mở
          </span>
          <span className="flex items-center gap-1.5">
            <Keycap>Esc</Keycap> đóng
          </span>
        </div>
      </Overlay>
      <ConfirmDialog
        open={confirmTrash}
        title="Dọn sạch thùng rác?"
        description="Mọi ghi chú trong thùng rác sẽ bị xóa vĩnh viễn và không thể khôi phục."
        confirmLabel="Xóa vĩnh viễn"
        onCancel={() => setConfirmTrash(false)}
        onConfirm={() => {
          setConfirmTrash(false);
          void api.notes
            .emptyTrash()
            .then((n) => pushToast({ message: `Đã xóa vĩnh viễn ${n} ghi chú`, durationMs: 4000 }))
            .catch((e) => pushToast({ message: `Không dọn được thùng rác: ${e}`, durationMs: 6000 }));
        }}
      />
    </>
  );
}
