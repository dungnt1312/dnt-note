import { useEffect, useState } from "react";
import {
  FileText,
  Image,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Search,
  Settings,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { useNotesStore } from "../../lib/store/notesStore";
import { useChatStore } from "../../lib/store/chatStore";
import { useUi, type Workspace } from "../../lib/store/uiStore";
import { groupByTime } from "../../lib/dates";
import { cn } from "../../lib/utils";
import { NoteList } from "../notes/NoteList";
import { IconButton, Keycap } from "../ui/Button";
import { Menu, MenuItem, MenuSeparator } from "../ui/Menu";
import { ConfirmDialog } from "../ui/Dialog";
import { SidebarRow, SidebarSectionLabel } from "./SidebarRow";
import { useDeleteNote } from "../notes/useDeleteNote";
import { countMedia, useMediaStore, type MediaFilter } from "../../lib/store/mediaStore";

/** Collapse sidebar + contextual "new" button; also shown in content headers when hidden. */
export function SidebarControls() {
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const visible = useUi((s) => s.sidebarVisible);
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <IconButton label={visible ? "Ẩn thanh bên (Ctrl+\\)" : "Hiện thanh bên (Ctrl+\\)"} onClick={toggleSidebar}>
        <PanelLeft size={17} strokeWidth={1.75} aria-hidden="true" />
      </IconButton>
      <NewItemButton />
    </div>
  );
}

export function NewItemButton() {
  const workspace = useUi((s) => s.workspace);
  const setSection = useUi((s) => s.setSection);
  const create = useNotesStore((s) => s.create);
  const newChat = useChatStore((s) => s.newChat);
  const chat = workspace === "chat";
  return (
    <IconButton
      label={chat ? "Hội thoại mới (Ctrl+Shift+O)" : "Ghi chú mới (Ctrl+N)"}
      onClick={() => {
        if (chat) {
          void newChat();
          setSection("chat");
        } else {
          setSection("notes");
          void create();
        }
      }}
    >
      <SquarePen size={17} strokeWidth={1.75} aria-hidden="true" />
    </IconButton>
  );
}

function WorkspaceSwitcher() {
  const workspace = useUi((s) => s.workspace);
  const setSection = useUi((s) => s.setSection);
  const tabs: { id: Workspace; label: string; icon: React.ReactNode; hint: string }[] = [
    { id: "notes", label: "Ghi chú", icon: <FileText size={13} />, hint: "Ctrl+1" },
    { id: "chat", label: "Trợ lý", icon: <MessageSquare size={13} />, hint: "Ctrl+2" },
    { id: "media", label: "Media", icon: <Image size={13} />, hint: "Ctrl+3" },
  ];
  return (
    <div role="tablist" aria-label="Khu làm việc" className="flex gap-0.5 rounded-[10px] bg-hover p-[3px]">
      {tabs.map((t) => {
        const active = workspace === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={`${t.label} (${t.hint})`}
            onClick={() => setSection(t.id)}
            className={cn(
              "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm text-callout font-medium transition-colors",
              active ? "bg-control text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-fg-secondary hover:text-fg",
            )}
          >
            <span aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function SearchField({
  value,
  onChange,
  id = "note-search",
  placeholder = "Tìm ghi chú",
}: {
  value: string;
  onChange: (q: string) => void;
  id?: string;
  placeholder?: string;
}) {
  const searchQuery = value;
  const setSearchQuery = onChange;
  return (
    <div className="relative">
      <Search
        size={13}
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-tertiary"
      />
      <input
        id={id}
        type="search"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && searchQuery) {
            e.stopPropagation();
            setSearchQuery("");
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={cn(
          "h-8 w-full rounded-sm border border-hairline bg-control pl-8 pr-7 text-callout text-fg outline-none transition-colors",
          "focus:border-fg-tertiary [&::-webkit-search-cancel-button]:hidden",
        )}
      />
      {searchQuery && (
        <button
          type="button"
          aria-label="Xóa tìm kiếm"
          onClick={() => setSearchQuery("")}
          className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-fg-tertiary hover:bg-hover hover:text-fg"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function TagFilterRow() {
  const tags = useNotesStore((s) => s.tags);
  const tagFilter = useUi((s) => s.tagFilter);
  const setTagFilter = useUi((s) => s.setTagFilter);
  if (tags.length === 0) return null;
  return (
    <div className="fade-x flex gap-1.5 overflow-x-auto px-3 pt-2" role="group" aria-label="Lọc theo thẻ">
      {tags.map(({ name, count }) => {
        const active = tagFilter === name;
        return (
          <button
            key={name}
            type="button"
            aria-pressed={active}
            onClick={() => setTagFilter(active ? null : name)}
            className={cn(
              "flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-footnote font-medium transition-colors",
              active ? "bg-accent text-accent-fg" : "bg-hover text-fg-secondary hover:text-fg",
            )}
          >
            #{name}
            <span className={cn("tabular-nums", active ? "opacity-70" : "text-fg-tertiary")}>{count}</span>
            {active && <X size={10} strokeWidth={2.5} aria-hidden="true" />}
          </button>
        );
      })}
      <span aria-hidden="true" className="w-4 shrink-0" />
    </div>
  );
}

function NotesPane() {
  const notes = useNotesStore((s) => s.notes);
  const selectedId = useNotesStore((s) => s.selectedId);
  const select = useNotesStore((s) => s.select);
  const setPinned = useNotesStore((s) => s.setPinned);
  const searchQuery = useUi((s) => s.searchQuery);
  const tagFilter = useUi((s) => s.tagFilter);
  const section = useUi((s) => s.section);
  const setSection = useUi((s) => s.setSection);
  const deleteNote = useDeleteNote();
  const setSearchQuery = useUi((s) => s.setSearchQuery);

  const visible = tagFilter ? notes.filter((n) => n.tags.includes(tagFilter)) : notes;

  return (
    <>
      <div className="px-3">
        <SearchField value={searchQuery} onChange={setSearchQuery} />
      </div>
      <TagFilterRow />
      <nav aria-label="Danh sách ghi chú" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <NoteList
          notes={visible}
          selectedId={section === "notes" ? selectedId : null}
          onSelect={(id) => {
            setSection("notes");
            void select(id);
          }}
          onDelete={deleteNote}
          onTogglePin={(id, pinned) => void setPinned(id, pinned)}
          query={searchQuery}
        />
      </nav>
    </>
  );
}

function SessionsPane() {
  const sessions = useChatStore((s) => s.sessions);
  const chatId = useChatStore((s) => s.chatId);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const loadChat = useChatStore((s) => s.loadChat);
  const renameChat = useChatStore((s) => s.renameChat);
  const deleteChat = useChatStore((s) => s.deleteChat);
  const section = useUi((s) => s.section);
  const setSection = useUi((s) => s.setSection);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  return (
    <nav aria-label="Lịch sử hội thoại" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {sessions.length === 0 && (
        <p className="px-3 pt-10 text-center text-callout text-fg-secondary">Chưa có hội thoại nào</p>
      )}
      {groupByTime(sessions, (s) => s.updated).map((g) => (
        <section key={g.key} aria-label={g.label}>
          <SidebarSectionLabel>{g.label}</SidebarSectionLabel>
          <ul className="flex flex-col gap-px">
            {g.items.map((s) => {
              const active = s.id === chatId && section === "chat";
              if (renaming === s.id) {
                return (
                  <li key={s.id}>
                    <input
                      autoFocus
                      value={draft}
                      aria-label="Tên hội thoại"
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => {
                        void renameChat(s.id, draft);
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setRenaming(null);
                        }
                      }}
                      className="h-[34px] w-full rounded-sm border border-fg-tertiary bg-control px-2.5 text-callout text-fg outline-none"
                    />
                  </li>
                );
              }
              return (
                <li key={s.id}>
                  <SidebarRow
                    selected={active}
                    onSelect={() => {
                      void loadChat(s.id);
                      setSection("chat");
                    }}
                    actions={
                      <Menu
                        width={190}
                        trigger={(p) => (
                          <button
                            type="button"
                            {...p}
                            aria-label={`Tùy chọn cho “${s.title}”`}
                            title="Tùy chọn"
                            className="flex size-7 items-center justify-center rounded-sm text-fg-secondary hover:bg-selected hover:text-fg"
                          >
                            <MoreHorizontal size={15} aria-hidden="true" />
                          </button>
                        )}
                      >
                        <MenuItem
                          icon={<Pencil size={14} />}
                          onSelect={() => {
                            setDraft(s.title);
                            setRenaming(s.id);
                          }}
                        >
                          Đổi tên
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem destructive icon={<Trash2 size={14} />} onSelect={() => setDeleting(s)}>
                          Xóa hội thoại
                        </MenuItem>
                      </Menu>
                    }
                  >
                    <span className={cn("block truncate pr-6 text-callout text-fg", active && "font-medium")}>
                      {s.title}
                    </span>
                  </SidebarRow>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <ConfirmDialog
        open={deleting !== null}
        title={`Xóa hội thoại “${deleting?.title ?? ""}”?`}
        description="Toàn bộ tin nhắn trong hội thoại này sẽ bị xóa. Ghi chú không bị ảnh hưởng."
        confirmLabel="Xóa"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void deleteChat(deleting.id);
          setDeleting(null);
        }}
      />
    </nav>
  );
}

const MEDIA_FILTERS: { id: MediaFilter; label: string }[] = [
  { id: "all", label: "Tất cả" },
  { id: "image", label: "Ảnh" },
  { id: "document", label: "Tài liệu" },
  { id: "audio", label: "Âm thanh" },
  { id: "unused", label: "Chưa dùng" },
];

function MediaPane() {
  const items = useMediaStore((s) => s.items);
  const filter = useMediaStore((s) => s.filter);
  const setFilter = useMediaStore((s) => s.setFilter);
  const query = useMediaStore((s) => s.query);
  const setQuery = useMediaStore((s) => s.setQuery);
  const section = useUi((s) => s.section);
  const setSection = useUi((s) => s.setSection);
  const counts = countMedia(items);
  return (
    <>
      <div className="px-3">
        <SearchField value={query} onChange={setQuery} id="media-search" placeholder="Tìm tệp" />
      </div>
      <nav aria-label="Lọc tệp" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-2">
        <ul className="flex flex-col gap-px">
          {MEDIA_FILTERS.map((f) => (
            <li key={f.id}>
              <SidebarRow
                selected={section === "media" && filter === f.id}
                onSelect={() => {
                  setFilter(f.id);
                  setSection("media");
                }}
              >
                <span className="flex items-center py-0.5">
                  <span className="flex-1 text-callout text-fg">{f.label}</span>
                  <span className="text-footnote tabular-nums text-fg-tertiary">{counts[f.id]}</span>
                </span>
              </SidebarRow>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

export function Sidebar() {
  const visible = useUi((s) => s.sidebarVisible);
  const workspace = useUi((s) => s.workspace);
  const section = useUi((s) => s.section);
  const setSection = useUi((s) => s.setSection);

  if (!visible) return null;

  return (
    <aside aria-label="Thanh bên" className="flex w-[264px] shrink-0 flex-col border-r border-hairline bg-sidebar">
      <div data-tauri-drag-region className="flex h-[52px] shrink-0 items-center gap-2 pl-4 pr-2.5">
        <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded-[7px] bg-accent text-accent-fg"
          >
            <FileText size={13} strokeWidth={2.25} />
          </span>
          <span data-tauri-drag-region className="truncate text-callout font-semibold text-fg">
            DNT Note
          </span>
        </div>
        <SidebarControls />
      </div>

      <div className="px-3 pb-2.5">
        <WorkspaceSwitcher />
      </div>

      {workspace === "chat" ? <SessionsPane /> : workspace === "media" ? <MediaPane /> : <NotesPane />}

      <div className="border-t border-hairline p-2">
        <SidebarRow selected={section === "settings"} onSelect={() => setSection("settings")}>
          <span className="flex items-center gap-2.5 py-0.5">
            <Settings size={15} aria-hidden="true" className="text-fg-secondary" />
            <span className="flex-1 text-callout font-medium text-fg">Cài đặt</span>
            <Keycap>Ctrl ,</Keycap>
          </span>
        </SidebarRow>
      </div>
    </aside>
  );
}
