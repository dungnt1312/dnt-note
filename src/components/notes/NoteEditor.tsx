import { ATTACHABLE } from "../../lib/media/extensions";
import { useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
  Copy,
  FileDown,
  FileText,
  History,
  MoreHorizontal,
  Paperclip,
  Pin,
  Plus,
  Sparkles,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";
import { mediaApi } from "../../lib/api/media";
import { countAttachmentRefs, fileToBase64, markdownLinkFor, MAX_FILES_PER_NOTE } from "../../lib/media/insertLink";
import { isTauri } from "../../lib/env";
import { editorSetup } from "../../lib/editor/editorSetup";
import { getTracked, setTracked, untrack } from "../../lib/editor/trackedPos";
import { fullDateTime, relativeTime } from "../../lib/dates";
import { cn, errMsg } from "../../lib/utils";
import { ContentHeader } from "../layout/ContentHeader";
import { IconButton, Keycap, PillButton } from "../ui/Button";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../ui/Menu";
import { TagStrip } from "./TagStrip";
import { FormatBar } from "./FormatBar";
import { useDeleteNote } from "./useDeleteNote";
import { HistoryDialog } from "./HistoryDialog";
import { Backlinks } from "./Backlinks";
import { openWikiLink } from "../../lib/editor/openWikiLink";

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const onChangeRef = useRef(setBody);
  onChangeRef.current = setBody;
  const onFilesRef = useRef<(files: File[], pos: number, text?: string) => void>(() => {});
  const trackSeq = useRef(0);

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
          onModS: () => void flushSave().catch(() => {}),
          onFiles: (files, pos, text) => onFilesRef.current(files, pos, text),
          wikiLinks: {
            titles: () => useNotesStore.getState().notes.map((n) => n.title).filter(Boolean),
            onOpen: (target) => void openWikiLink(target),
          },
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

  // Insert `text` at `pos` (clamped), return the position after it.
  const insertAt = (v: EditorView, pos: number, text: string): number => {
    const at = Math.min(Math.max(0, pos), v.state.doc.length);
    const before = at > 0 ? v.state.doc.sliceString(at - 1, at) : "\n";
    const insert = (before === "\n" ? "" : "\n") + text;
    v.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length } });
    return at + insert.length;
  };

  onFilesRef.current = (files, pos, text) => {
    if (!isTauri || !view) return;
    const v = view;
    const noteId = note.id;
    const trackId = ++trackSeq.current;
    // Pasted text goes in first so it is never lost.
    let start = pos;
    if (text) {
      v.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
      start = pos + text.length;
    }
    v.dispatch({ effects: setTracked.of({ id: trackId, pos: start }) });
    const alive = () => v.dom.isConnected && useNotesStore.getState().selectedId === noteId;
    void (async () => {
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          // Links inserted earlier in this batch are already in the doc.
          if (countAttachmentRefs(v.state.doc.toString()) >= MAX_FILES_PER_NOTE) {
            pushToast({
              message: `Tối đa ${MAX_FILES_PER_NOTE} file đính kèm mỗi ghi chú — bỏ qua ${files.length - i} tệp`,
              durationMs: 6000,
            });
            return;
          }
          try {
            const name = file.name || `pasted-${Date.now()}.png`;
            const b64 = await fileToBase64(file);
            const stored = await mediaApi.attachBytes(noteId, name, b64);
            if (!alive()) {
              pushToast({ message: "Ghi chú đã đổi — các liên kết còn lại chưa được chèn", durationMs: 6000 });
              return;
            }
            const at = getTracked(v.state, trackId) ?? v.state.selection.main.head;
            const end = insertAt(v, at, markdownLinkFor(stored.name));
            v.dispatch({ effects: setTracked.of({ id: trackId, pos: end }) });
          } catch (e) {
            pushToast({ message: `Không đính kèm được ${file.name}: ${errMsg(e)}`, durationMs: 6000 });
          }
        }
      } finally {
        if (v.dom.isConnected) v.dispatch({ effects: untrack.of(trackId) });
      }
    })();
  };

  const attach = async () => {
    if (!isTauri || !view) return;
    try {
      if (countAttachmentRefs(view.state.doc.toString()) >= MAX_FILES_PER_NOTE) {
        pushToast({ message: `Tối đa ${MAX_FILES_PER_NOTE} file đính kèm mỗi ghi chú`, durationMs: 5000 });
        return;
      }
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: false,
        filters: [{ name: "Tệp đính kèm", extensions: ATTACHABLE }],
      });
      if (typeof picked !== "string") return;
      const stored = await mediaApi.import(picked);
      insertAt(view, view.state.selection.main.head, markdownLinkFor(stored.name));
      view.focus();
    } catch (e) {
      pushToast({ message: `Không đính kèm được: ${errMsg(e)}`, durationMs: 6000 });
    }
  };

  const exportPdf = async () => {
    if (!isTauri) return;
    await flushSave();
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    void new WebviewWindow(`print-${note.id.slice(0, 8)}-${Date.now()}`, {
      url: `index.html?print=${note.id}`,
      title: `Xuất PDF — ${note.title}`,
      width: 820,
      height: 1000,
    });
    pushToast({ message: "Đã mở cửa sổ in — chọn “Save as PDF”", durationMs: 5000 });
  };

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
              <MenuItem icon={<Paperclip size={14} />} disabled={!isTauri} onSelect={() => void attach()}>
                Đính kèm ảnh hoặc tệp…
              </MenuItem>
              <MenuItem icon={<FileDown size={14} />} disabled={!isTauri} onSelect={() => void exportPdf()}>
                Xuất PDF…
              </MenuItem>
              <MenuItem icon={<History size={14} />} disabled={!isTauri} onSelect={() => setHistoryOpen(true)}>
                Lịch sử phiên bản…
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
            {historyOpen && <HistoryDialog noteId={note.id} onClose={() => setHistoryOpen(false)} />}
          </>
        }
      />

      <FormatBar view={view} stats={wordStats(body)} noteId={note.id} />
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
          <Backlinks noteId={note.id} />
        </div>
      </div>
    </main>
  );
}
