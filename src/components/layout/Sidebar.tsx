import { useEffect, useState } from "react";
import {
  FileText,
  Images,
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
import type { NoteMeta } from "../../lib/api/notes";
import { useChatStore } from "../../lib/store/chatStore";
import { useUi, type Workspace } from "../../lib/store/uiStore";
import { groupByTime } from "../../lib/dates";
import { cn } from "../../lib/utils";
import { NoteList } from "../notes/NoteList";
import { FolderSection } from "../notes/FolderSection";
import { MoveNoteDialog } from "../notes/MoveNoteDialog";
import { IconButton, Keycap } from "../ui/Button";
import { Menu, MenuItem, MenuSeparator } from "../ui/Menu";
import { ConfirmDialog } from "../ui/Dialog";
import { SidebarRow, SidebarSectionLabel } from "./SidebarRow";
import { useDeleteNote } from "../notes/useDeleteNote";
import { BrandMark } from "../common/BrandMark";
import { useT } from "../../lib/i18n";

/** Collapse sidebar + contextual "new" button; also shown in content headers when hidden. */
export function SidebarControls() {
  const t = useT();
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const visible = useUi((s) => s.sidebarVisible);
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <IconButton label={visible ? t("sidebar.hideSidebar") : t("sidebar.showSidebar")} onClick={toggleSidebar}>
        <PanelLeft size={17} strokeWidth={1.75} aria-hidden="true" />
      </IconButton>
      <NewItemButton />
    </div>
  );
}

export function NewItemButton() {
  const t = useT();
  const workspace = useUi((s) => s.workspace);
  const setSection = useUi((s) => s.setSection);
  const create = useNotesStore((s) => s.create);
  const newChat = useChatStore((s) => s.newChat);
  const chat = workspace === "chat";
  return (
    <IconButton
      label={chat ? t("sidebar.newChat") : t("sidebar.newNote")}
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
  const t = useT();
  const workspace = useUi((s) => s.workspace);
  const setSection = useUi((s) => s.setSection);
  const tabs: { id: Workspace; label: string; icon: React.ReactNode; hint: string }[] = [
    { id: "notes", label: t("sidebar.tabNotes"), icon: <FileText size={13} />, hint: "Ctrl+1" },
    { id: "chat", label: t("sidebar.tabAssistant"), icon: <MessageSquare size={13} />, hint: "Ctrl+2" },
  ];
  return (
    <div role="tablist" aria-label={t("sidebar.workspace")} className="flex gap-0.5 rounded-[10px] bg-hover p-[3px]">
      {tabs.map((tab) => {
        const active = workspace === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={`${tab.label} (${tab.hint})`}
            onClick={() => setSection(tab.id)}
            className={cn(
              "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm text-callout font-medium transition-colors",
              active ? "bg-control text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-fg-secondary hover:text-fg",
            )}
          >
            <span aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function SearchField() {
  const t = useT();
  const searchQuery = useUi((s) => s.searchQuery);
  const setSearchQuery = useUi((s) => s.setSearchQuery);
  return (
    <div className="relative">
      <Search
        size={13}
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-tertiary"
      />
      <input
        id="note-search"
        type="search"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && searchQuery) {
            e.stopPropagation();
            setSearchQuery("");
          }
        }}
        placeholder={t("sidebar.searchPlaceholder")}
        aria-label={t("sidebar.searchPlaceholder")}
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
          aria-label={t("sidebar.clearSearch")}
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
  const t = useT();
  if (tags.length === 0) return null;
  return (
    <div className="fade-x flex gap-1.5 overflow-x-auto px-3 pt-2" role="group" aria-label={t("sidebar.filterByTags")}>
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
  const t = useT();
  const notes = useNotesStore((s) => s.notes);
  const selectedId = useNotesStore((s) => s.selectedId);
  const select = useNotesStore((s) => s.select);
  const setPinned = useNotesStore((s) => s.setPinned);
  const searchQuery = useUi((s) => s.searchQuery);
  const tagFilter = useUi((s) => s.tagFilter);
  const folderFilter = useUi((s) => s.folderFilter);
  const section = useUi((s) => s.section);
  const setSection = useUi((s) => s.setSection);
  const deleteNote = useDeleteNote();
  const [moveTarget, setMoveTarget] = useState<NoteMeta | null>(null);

  const visible = notes
    .filter((n) =>
      folderFilter ? (n.folder ?? "").toLowerCase() === folderFilter.toLowerCase() : true,
    )
    .filter((n) => (tagFilter ? n.tags.includes(tagFilter) : true));

  return (
    <>
      <div className="px-3">
        <SearchField />
      </div>
      <FolderSection />
      <TagFilterRow />
      <nav aria-label={t("sidebar.noteList")} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <NoteList
          notes={visible}
          selectedId={section === "notes" ? selectedId : null}
          onSelect={(id) => {
            setSection("notes");
            void select(id);
          }}
          onDelete={deleteNote}
          onTogglePin={(id, pinned) => void setPinned(id, pinned)}
          onMove={(id) => setMoveTarget(notes.find((n) => n.id === id) ?? null)}
          query={searchQuery}
        />
      </nav>
      <MoveNoteDialog note={moveTarget} onClose={() => setMoveTarget(null)} />
    </>
  );
}

function SessionsPane() {
  const t = useT();
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
    <nav aria-label={t("sidebar.chatHistory")} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {sessions.length === 0 && (
        <p className="px-3 pt-10 text-center text-callout text-fg-secondary">{t("sidebar.noChats")}</p>
      )}
      {groupByTime(sessions, (s) => s.updated).map((g) => (
        <section key={g.key} aria-label={t(`sidebar.group.${g.key}`)}>
          <SidebarSectionLabel>{t(`sidebar.group.${g.key}`)}</SidebarSectionLabel>
          <ul className="flex flex-col gap-px">
            {g.items.map((s) => {
              const active = s.id === chatId && section === "chat";
              if (renaming === s.id) {
                return (
                  <li key={s.id}>
                    <input
                      autoFocus
                      value={draft}
                      aria-label={t("sidebar.chatTitle")}
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
                            aria-label={t("sidebar.optionsFor", { title: s.title })}
                            title={t("sidebar.options")}
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
                          {t("sidebar.rename")}
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem destructive icon={<Trash2 size={14} />} onSelect={() => setDeleting(s)}>
                          {t("sidebar.deleteChat")}
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
        title={t("sidebar.deleteChatTitle", { title: deleting?.title ?? "" })}
        description={t("sidebar.deleteChatDesc")}
        confirmLabel={t("sidebar.delete")}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void deleteChat(deleting.id);
          setDeleting(null);
        }}
      />
    </nav>
  );
}

export function Sidebar() {
  const t = useT();
  const visible = useUi((s) => s.sidebarVisible);
  const workspace = useUi((s) => s.workspace);
  const section = useUi((s) => s.section);
  const setSection = useUi((s) => s.setSection);

  if (!visible) return null;

  return (
    <aside aria-label={t("sidebar.sidebar")} className="flex w-[264px] shrink-0 flex-col border-r border-hairline bg-sidebar">
      <div data-tauri-drag-region className="flex h-[52px] shrink-0 items-center gap-2 pl-4 pr-2.5">
        <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">
          <BrandMark size={24} className="shrink-0 text-fg" />
          <span data-tauri-drag-region className="truncate text-callout font-semibold text-fg">
            DNT Note
          </span>
        </div>
        <SidebarControls />
      </div>

      <div className="px-3 pb-2.5">
        <WorkspaceSwitcher />
      </div>

      {workspace === "chat" ? <SessionsPane /> : <NotesPane />}

      <div className="border-t border-hairline p-2">
        <SidebarRow selected={section === "media"} onSelect={() => setSection("media")}>
          <span className="flex items-center gap-2.5 py-0.5">
            <Images size={15} aria-hidden="true" className="text-fg-secondary" />
            <span className="flex-1 text-callout font-medium text-fg">{t("sidebar.media")}</span>
          </span>
        </SidebarRow>
        <SidebarRow selected={section === "settings"} onSelect={() => setSection("settings")}>
          <span className="flex items-center gap-2.5 py-0.5">
            <Settings size={15} aria-hidden="true" className="text-fg-secondary" />
            <span className="flex-1 text-callout font-medium text-fg">{t("sidebar.settings")}</span>
            <Keycap>Ctrl ,</Keycap>
          </span>
        </SidebarRow>
      </div>
    </aside>
  );
}
