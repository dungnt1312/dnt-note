import { useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
  Copy,
  FileText,
  MoreHorizontal,
  Pin,
  Plus,
  Sparkles,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";
import { editorSetup } from "../../lib/editor/editorSetup";
import { fullDateTime, relativeTime } from "../../lib/dates";
import { cn } from "../../lib/utils";
import { ContentHeader } from "../layout/ContentHeader";
import { IconButton, Keycap, PillButton } from "../ui/Button";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../ui/Menu";
import { TagStrip } from "./TagStrip";
import { FormatBar } from "./FormatBar";
import { useDeleteNote } from "./useDeleteNote";

/** "✦ Trợ lý" capsule that docks the assistant panel next to the editor. */
export function AssistantToggle() {
  const chatOpen = useUi((s) => s.chatOpen);
  const setChatOpen = useUi((s) => s.setChatOpen);
  return (
    <button
      type="button"
      aria-pressed={chatOpen}
      title={chatOpen ? "Ẩn trợ lý (Ctrl+Shift+J)" : "Mở trợ lý cạnh ghi chú (Ctrl+Shift+J)"}
      onClick={() => setChatOpen(!chatOpen)}
      className={cn(
        "ml-1.5 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-callout font-medium transition-colors",
        chatOpen ? "bg-accent text-accent-fg hover:bg-accent-hover" : "bg-hover text-fg hover:bg-selected",
      )}
    >
      <Sparkles size={14} aria-hidden="true" />
      Trợ lý
    </button>
  );
}

function wordStats(body: string): string {
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  if (words === 0) return "0 từ";
  if (words > 200) return `${words.toLocaleString("vi-VN")} từ · ${Math.max(1, Math.round(words / 220))} phút đọc`;
  return `${words} từ`;
}

function EmptyState() {
  const create = useNotesStore((s) => s.create);
  const hasNotes = useNotesStore((s) => s.notes.length > 0);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-16 text-center">
      <SquarePen size={36} strokeWidth={1.25} aria-hidden="true" className="text-fg-tertiary" />
      <h2 className="text-headline font-semibold text-fg">
        {hasNotes ? "Chọn một ghi chú để bắt đầu" : "Chưa có ghi chú nào"}
      </h2>
      <p className="max-w-[320px] text-callout text-fg-secondary">
        Ghi chú tự động lưu thành file Markdown ngay trên máy của bạn.
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <PillButton onClick={() => void create()}>
          <Plus size={15} strokeWidth={2.25} aria-hidden="true" />
          Ghi chú mới
        </PillButton>
        <Keycap>Ctrl N</Keycap>
      </div>
    </div>
  );
}

export function NoteEditor() {
  const selectedId = useNotesStore((s) => s.selectedId);
  const body = useNotesStore((s) => s.body);
  const saveState = useNotesStore((s) => s.saveState);
  const notes = useNotesStore((s) => s.notes);
  const setBody = useNotesStore((s) => s.setBody);
  const setTitle = useNotesStore((s) => s.setTitle);
  const setPinned = useNotesStore((s) => s.setPinned);
  const setTags = useNotesStore((s) => s.setTags);
  const flushSave = useNotesStore((s) => s.flushSave);
  const pushToast = useUi((s) => s.pushToast);
  // The docked assistant is the right-most pane and owns the caption buttons.
  const chatOpen = useUi((s) => s.chatOpen);
  const deleteNote = useDeleteNote();

  const editorHost = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const onChangeRef = useRef(setBody);
  onChangeRef.current = setBody;

  const note = notes.find((n) => n.id === selectedId) ?? null;
  const [titleDraft, setTitleDraft] = useState(note?.title ?? "");
  const hasEditor = Boolean(note) && body !== null;

  // (Re)create the editor when the selected note changes.
  useEffect(() => {
    if (!editorHost.current || selectedId === null || body === null) return;
    const v = new EditorView({
      state: EditorState.create({
        doc: body,
        extensions: editorSetup({
          onChange: (value) => onChangeRef.current(value),
          onModS: () => void flushSave(),
        }),
      }),
      parent: editorHost.current,
    });
    setView(v);
    return () => {
      v.destroy();
      setView(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, hasEditor]);

  // Pull external edits (MCP / sync / attachments) into the open editor.
  useEffect(() => {
    if (!view || body === null) return;
    const current = view.state.doc.toString();
    if (current !== body && saveState === "saved") {
      view.dispatch({ changes: { from: 0, to: current.length, insert: body } });
    }
  }, [body, view, saveState]);

  // Title draft follows the selected note.
  useEffect(() => {
    setTitleDraft(note?.title ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, note?.title]);

  if (!note || body === null) {
    return (
      <main className="flex min-w-0 flex-1 flex-col bg-app">
        <ContentHeader trailing={<AssistantToggle />} windowControls={!chatOpen} />
        <EmptyState />
      </main>
    );
  }

  const commitTitle = () => {
    const t = titleDraft.trim();
    if (t && t !== note.title) void setTitle(note.id, t);
    else setTitleDraft(note.title);
  };

  const saveLabel =
    saveState === "saving" ? "Đang lưu…" : saveState === "dirty" ? "Chưa lưu" : `Đã lưu ${relativeTime(note.updated)}`;

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-app">
      <ContentHeader
        windowControls={!chatOpen}
        leading={
          <div className="flex min-w-0 items-center gap-1.5 pl-2 text-footnote text-fg-tertiary">
            <FileText size={12} aria-hidden="true" className="shrink-0" />
            <span className="truncate text-fg-secondary">{note.title || "Chưa đặt tên"}.md</span>
            <span aria-live="polite" className="shrink-0 whitespace-nowrap">
              · {saveLabel}
            </span>
          </div>
        }
        trailing={
          <>
            <IconButton
              label={note.pinned ? "Bỏ ghim" : "Ghim lên đầu danh sách"}
              active={note.pinned}
              onClick={() => void setPinned(note.id, !note.pinned)}
            >
              <Pin size={16} strokeWidth={1.75} aria-hidden="true" className={cn(note.pinned && "fill-current")} />
            </IconButton>
            <Menu
              width={248}
              trigger={(p) => (
                <IconButton label="Thao tác khác" {...p}>
                  <MoreHorizontal size={17} aria-hidden="true" />
                </IconButton>
              )}
            >
              <MenuItem
                icon={<Copy size={14} />}
                onSelect={() => {
                  void navigator.clipboard.writeText(body).then(() =>
                    pushToast({ message: "Đã sao chép Markdown", durationMs: 3000 }),
                  );
                }}
              >
                Sao chép Markdown
              </MenuItem>
              <MenuSeparator />
              <MenuLabel>
                Tạo {fullDateTime(note.created)} · {wordStats(body)}
              </MenuLabel>
              <MenuSeparator />
              <MenuItem destructive icon={<Trash2 size={14} />} onSelect={() => deleteNote(note.id)}>
                Xóa ghi chú
              </MenuItem>
            </Menu>
            <AssistantToggle />
          </>
        }
      />

      <FormatBar view={view} stats={wordStats(body)} />
      <div className="h-px shrink-0 bg-hairline" />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-10 pt-8">
          <input
            value={titleDraft}
            aria-label="Tiêu đề ghi chú"
            placeholder="Chưa đặt tên"
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTitle();
                view?.focus();
              } else if (e.key === "Escape") {
                setTitleDraft(note.title);
                e.currentTarget.blur();
              }
            }}
            className="w-full bg-transparent text-large-title font-bold tracking-[-0.01em] text-fg outline-none placeholder:text-fg-tertiary"
          />
          <div className="mb-4 mt-2.5">
            <TagStrip tags={note.tags} onChange={(tags) => void setTags(note.id, tags)} />
          </div>
          <div ref={editorHost} />
        </div>
      </div>
    </main>
  );
}
