import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FileText,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeft,
  Search,
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
import { fuzzyRank } from "../../lib/fuzzy";
import { shortDate } from "../../lib/dates";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { Keycap } from "../ui/Button";
import { ConfirmDialog, Overlay } from "../ui/Dialog";

type PaletteGroup = "commands" | "recentNotes" | "notes" | "chats";

interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  detail?: string;
  shortcut?: string;
  icon: ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const setSection = useUi((s) => s.setSection);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const setChatOpen = useUi((s) => s.setChatOpen);
  const pushToast = useUi((s) => s.pushToast);
  const { setTheme } = useTheme();
  const t = useT();
  const groupLabels: Record<PaletteGroup, string> = {
    commands: t("app.groupCommands"),
    recentNotes: t("app.groupRecentNotes"),
    notes: t("app.groupNotes"),
    chats: t("app.groupChats"),
  };

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

  const close = () => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  };

  const items = useMemo(() => {
    const commands: PaletteItem[] = [
      { id: "new-note", group: "commands", label: t("app.cmdNewNote"), shortcut: "Ctrl N", icon: <SquarePen size={15} />, run: () => {
        setSection("notes");
        void create();
      } },
      { id: "new-chat", group: "commands", label: t("app.cmdNewChat"), shortcut: "Ctrl ⇧ O", icon: <MessageSquare size={15} />, run: () => {
        void newChat();
        setSection("chat");
      } },
      { id: "go-notes", group: "commands", label: t("app.cmdGoNotes"), shortcut: "Ctrl 1", icon: <FileText size={15} />, run: () => setSection("notes") },
      { id: "go-chat", group: "commands", label: t("app.cmdGoChat"), shortcut: "Ctrl 2", icon: <Sparkles size={15} />, run: () => setSection("chat") },
      { id: "side-chat", group: "commands", label: t("app.cmdChatDocked"), shortcut: "Ctrl ⇧ J", icon: <Sparkles size={15} />, run: () => {
        setSection("notes");
        setChatOpen(true);
      } },
      { id: "sidebar", group: "commands", label: t("app.cmdToggleSidebar"), shortcut: "Ctrl \\", icon: <PanelLeft size={15} />, run: toggleSidebar },
      { id: "theme-light", group: "commands", label: t("app.cmdThemeLight"), icon: <Sun size={15} />, run: () => setTheme("light") },
      { id: "theme-dark", group: "commands", label: t("app.cmdThemeDark"), icon: <Moon size={15} />, run: () => setTheme("dark") },
      { id: "theme-system", group: "commands", label: t("app.cmdThemeSystem"), icon: <Monitor size={15} />, run: () => setTheme("system") },
      { id: "settings", group: "commands", label: t("app.cmdSettings"), shortcut: "Ctrl ,", icon: <Settings size={15} />, run: () => setSection("settings") },
      { id: "empty-trash", group: "commands", label: t("app.cmdEmptyTrash"), icon: <Trash2 size={15} />, run: () => setConfirmTrash(true) },
    ];
    const q = query.trim().toLowerCase();
    const cmd = fuzzyRank(commands, q, (c) => c.label.toLowerCase()).map((r) => r.item);
    const noteItems = fuzzyRank(notes, q, (n) => `${n.title} ${n.snippet}`)
      .slice(0, q ? 8 : 5)
      .map<PaletteItem>(({ item: n }) => ({
        id: `note-${n.id}`,
        group: q ? "notes" : "recentNotes",
        label: n.title || t("app.untitled"),
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
        group: "chats",
        label: s.title,
        detail: shortDate(s.updated),
        icon: <MessageSquare size={15} />,
        run: () => {
          void loadChat(s.id);
          setSection("chat");
        },
      }));
    return [...cmd, ...noteItems, ...chatItems];
  }, [query, notes, sessions, create, newChat, select, loadChat, setSection, setChatOpen, toggleSidebar, setTheme, t]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const runItem = (item: PaletteItem) => {
    close();
    item.run();
  };

  let lastGroup = "";

  return (
    <>
      <Overlay open={open} onClose={close} label={t("app.paletteLabel")} placement="top" className="w-[600px]">
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
            placeholder={t("app.searchPlaceholder")}
            aria-label={t("app.searchLabel")}
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
          {items.length === 0 && (
            <p className="py-7 text-center text-callout text-fg-secondary">{t("app.noResults", { query })}</p>
          )}
          {items.map((item, i) => {
            const header = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header && (
                  <div role="presentation" className="px-2.5 pb-1 pt-2.5 text-footnote font-semibold text-fg-secondary">
                    {groupLabels[item.group]}
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
            <Keycap>↑↓</Keycap> {t("app.navHint")}
          </span>
          <span className="flex items-center gap-1.5">
            <Keycap>↵</Keycap> {t("app.openHint")}
          </span>
          <span className="flex items-center gap-1.5">
            <Keycap>Esc</Keycap> {t("app.closeHint")}
          </span>
        </div>
      </Overlay>
      <ConfirmDialog
        open={confirmTrash}
        title={t("settings.emptyTrashTitle")}
        description={t("settings.emptyTrashDescription")}
        confirmLabel={t("settings.deleteForever")}
        onCancel={() => setConfirmTrash(false)}
        onConfirm={() => {
          setConfirmTrash(false);
          void api.notes
            .emptyTrash()
            .then((n) => pushToast({ message: t("settings.trashEmptied", { n }), durationMs: 4000 }))
            .catch((e) => pushToast({ message: t("settings.emptyTrashError", { error: String(e) }), durationMs: 6000 }));
        }}
      />
    </>
  );
}
