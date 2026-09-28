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
  Wand2,
} from "lucide-react";
import { useT, localeTag } from "../../lib/i18n";
import { useNotesStore } from "../../lib/store/notesStore";
import { useComposerStore } from "../../lib/store/composerStore";
import { useUi } from "../../lib/store/uiStore";
import { api } from "../../lib/api/notes";
import { attachmentsApi } from "../../lib/api/attachments";
import { isTauri } from "../../lib/env";
import { editorSetup } from "../../lib/editor/editorSetup";
import { getSelectionInfo } from "../../lib/editor/selection";
import { fullDateTime, relativeTime } from "../../lib/dates";
import { cn } from "../../lib/utils";
import { ContentHeader } from "../layout/ContentHeader";
import { IconButton, Keycap, PillButton } from "../ui/Button";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../ui/Menu";
import { TagStrip } from "./TagStrip";
import { FormatBar } from "./FormatBar";
import { EditorContextMenu } from "./EditorContextMenu";
import { useDeleteNote } from "./useDeleteNote";
import { Backlinks } from "./Backlinks";
import { HistoryDialog } from "./HistoryDialog";
import { SuggestDialog } from "./SuggestDialog";
import { VoiceRecorder } from "./VoiceRecorder";

/** "✦ Trợ lý" capsule that docks the assistant panel next to the editor. */
export function AssistantToggle() {
  const t = useT();
  const chatOpen = useUi((s) => s.chatOpen);
  const setChatOpen = useUi((s) => s.setChatOpen);
  return (
    <button
      type="button"
      aria-pressed={chatOpen}
      title={chatOpen ? t("notes.hideAssistant") : t("notes.showAssistant")}
      onClick={() => setChatOpen(!chatOpen)}
      className={cn(
        "ml-1.5 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-callout font-medium transition-colors",
        chatOpen ? "bg-accent text-accent-fg hover:bg-accent-hover" : "bg-hover text-fg hover:bg-selected",
      )}
    >
      <Sparkles size={14} aria-hidden="true" />
      {t("notes.assistant")}
    </button>
  );
}

const ATTACHABLE = [
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "pdf", "docx", "rtf", "odt", "txt", "md", "csv", "json",
  "rs", "py", "js", "ts", "tsx", "jsx", "go", "java", "c", "cpp", "html", "css", "toml", "yaml", "yml", "xml", "sh",
];

function wordStats(body: string, t: ReturnType<typeof useT>): string {
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  if (words === 0) return t("notes.statsNone");
  if (words > 200)
    return t("notes.statsReadTime", { n: words.toLocaleString(localeTag()), m: Math.max(1, Math.round(words / 220)) });
  return t("notes.statsWords", { n: words });
}

function EmptyState() {
  const t = useT();
  const create = useNotesStore((s) => s.create);
  const hasNotes = useNotesStore((s) => s.notes.length > 0);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-16 text-center">
      <SquarePen size={36} strokeWidth={1.25} aria-hidden="true" className="text-fg-tertiary" />
      <h2 className="text-headline font-semibold text-fg">
        {hasNotes ? t("notes.emptyPick") : t("notes.emptyNoNotes")}
      </h2>
      <p className="max-w-[320px] text-callout text-fg-secondary">
        {t("notes.emptyDesc")}
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <PillButton onClick={() => void create()}>
          <Plus size={15} strokeWidth={2.25} aria-hidden="true" />
          {t("notes.newNote")}
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
  const setChatOpen = useUi((s) => s.setChatOpen);
  const pushChatContext = useComposerStore((s) => s.pushChatContext);
  const deleteNote = useDeleteNote();
  const t = useT();

  const editorHost = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
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

  const attach = async () => {
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: false,
        filters: [{ name: t("notes.attachFilterName"), extensions: ATTACHABLE }],
      });
      if (typeof picked !== "string") return;
      await flushSave();
      const stored = await attachmentsApi.attach(note.id, picked);
      pushToast({ message: t("notes.attachedToast", { name: stored.name.split("-").slice(1).join("-") }), durationMs: 4000 });
      // Rust already appended the reference link to the body — load it back.
      const updated = await api.notes.read(note.id);
      useNotesStore.setState({ body: updated.body, saveState: "saved" });
    } catch (e) {
      pushToast({ message: t("notes.attachErrorToast", { error: String(e) }), durationMs: 6000 });
    }
  };

  const exportPdf = async () => {
    if (!isTauri) return;
    await flushSave();
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    void new WebviewWindow(`print-${note.id.slice(0, 8)}-${Date.now()}`, {
      url: `index.html?print=${note.id}`,
      title: t("notes.exportPdfWindowTitle", { title: note.title }),
      width: 820,
      height: 1000,
    });
    pushToast({ message: t("notes.printWindowToast"), durationMs: 5000 });
  };

  const openContextMenu = (e: React.MouseEvent) => {
    e.preventDefault(); // suppress the WebView2 native menu
    if (!view) return;
    const info = getSelectionInfo(view.state);
    setCtxMenu({ x: e.clientX, y: e.clientY, hasSelection: info.hasSelection });
  };

  const sendSelectionToAssistant = () => {
    if (!view) return;
    const info = getSelectionInfo(view.state);
    if (!info.hasSelection) return;
    pushChatContext({ kind: "snippet", title: `${note.title || t("notes.fallbackNoteLower")} ${t("notes.selectionSuffix")}`, text: info.text });
    setChatOpen(true);
  };

  const askAssistantAboutNote = () => {
    pushChatContext({ kind: "note", noteId: note.id, title: note.title || t("notes.fallbackNoteCapital") });
    setChatOpen(true);
  };

  const copySelection = () => {
    if (!view) return;
    const text = getSelectionInfo(view.state).text;
    void navigator.clipboard.writeText(text).then(() =>
      pushToast({ message: t("notes.copiedToast"), durationMs: 3000 }),
    );
  };

  const commitTitle = () => {
    const t = titleDraft.trim();
    if (t && t !== note.title) void setTitle(note.id, t);
    else setTitleDraft(note.title);
  };

  const saveLabel =
    saveState === "saving"
      ? t("notes.saving")
      : saveState === "dirty"
        ? t("notes.unsaved")
        : t("notes.savedTime", { time: relativeTime(note.updated) });

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-app">
      <ContentHeader
        windowControls={!chatOpen}
        leading={
          <div className="flex min-w-0 items-center gap-1.5 pl-2 text-footnote text-fg-tertiary">
            <FileText size={12} aria-hidden="true" className="shrink-0" />
            <span className="truncate text-fg-secondary">{note.title || t("notes.untitled")}.md</span>
            <span aria-live="polite" className="shrink-0 whitespace-nowrap">
              · {saveLabel}
            </span>
          </div>
        }
        trailing={
          <>
            <IconButton
              label={note.pinned ? t("notes.unpin") : t("notes.pinToList")}
              active={note.pinned}
              onClick={() => void setPinned(note.id, !note.pinned)}
            >
              <Pin size={16} strokeWidth={1.75} aria-hidden="true" className={cn(note.pinned && "fill-current")} />
            </IconButton>
            <Menu
              width={248}
              trigger={(p) => (
                <IconButton label={t("notes.moreActions")} {...p}>
                  <MoreHorizontal size={17} aria-hidden="true" />
                </IconButton>
              )}
            >
              <MenuItem
                icon={<Copy size={14} />}
                onSelect={() => {
                  void navigator.clipboard.writeText(body).then(() =>
                    pushToast({ message: t("notes.copiedMarkdownToast"), durationMs: 3000 }),
                  );
                }}
              >
                {t("notes.copyMarkdown")}
              </MenuItem>
              <MenuItem icon={<Paperclip size={14} />} disabled={!isTauri} onSelect={() => void attach()}>
                {t("notes.attachMenuItem")}
              </MenuItem>
              <MenuItem icon={<FileDown size={14} />} disabled={!isTauri} onSelect={() => void exportPdf()}>
                {t("notes.exportPdf")}
              </MenuItem>
              <MenuItem icon={<History size={14} />} disabled={!isTauri} onSelect={() => setHistoryOpen(true)}>
                {t("notes.historyMenuItem")}
              </MenuItem>
              <MenuItem icon={<Wand2 size={14} />} disabled={!isTauri} onSelect={() => setSuggestOpen(true)}>
                {t("notes.suggestMenuItem")}
              </MenuItem>
              <MenuSeparator />
              <MenuLabel>
                {t("notes.createdLabel", { created: fullDateTime(note.created), stats: wordStats(body, t) })}
              </MenuLabel>
              <MenuSeparator />
              <MenuItem destructive icon={<Trash2 size={14} />} onSelect={() => deleteNote(note.id)}>
                {t("notes.deleteNote")}
              </MenuItem>
            </Menu>
            <VoiceRecorder view={view} noteId={note.id} />
            <AssistantToggle />
          </>
        }
      />

      <FormatBar view={view} stats={wordStats(body, t)} />
      <div className="h-px shrink-0 bg-hairline" />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-10 pt-8">
          <input
            value={titleDraft}
            aria-label={t("notes.titleAriaLabel")}
            placeholder={t("notes.untitled")}
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
          <div ref={editorHost} onContextMenu={openContextMenu} />
          {isTauri && <Backlinks noteId={note.id} />}
        </div>
      </div>

      {ctxMenu && (
        <EditorContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          hasSelection={ctxMenu.hasSelection}
          onClose={() => setCtxMenu(null)}
          onSelection={sendSelectionToAssistant}
          onWholeNote={askAssistantAboutNote}
          onCopy={copySelection}
        />
      )}

      {historyOpen && <HistoryDialog noteId={note.id} onClose={() => setHistoryOpen(false)} />}
      {suggestOpen && (
        <SuggestDialog
          noteId={note.id}
          title={note.title}
          body={body}
          tags={note.tags}
          onClose={() => setSuggestOpen(false)}
        />
      )}
    </main>
  );
}
