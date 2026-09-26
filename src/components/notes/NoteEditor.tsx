import { useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { Pin, PinOff } from "lucide-react";
import { useNotesStore } from "../../lib/store/notesStore";
import { editorSetup } from "../../lib/editor/editorSetup";
import { TagInput } from "./TagInput";

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

  const editorHost = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(setBody);
  onChangeRef.current = setBody;

  const note = notes.find((n) => n.id === selectedId) ?? null;
  const [titleDraft, setTitleDraft] = useState(note?.title ?? "");

  // (Re)create the editor when the selected note changes.
  useEffect(() => {
    if (!editorHost.current || selectedId === null || body === null) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: body,
        extensions: editorSetup({
          onChange: (v) => onChangeRef.current(v),
          onModS: () => void flushSave(),
        }),
      }),
      parent: editorHost.current,
    });
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Title draft follows the selected note.
  useEffect(() => {
    setTitleDraft(note?.title ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  if (!note || body === null) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--text-faint)]">
        <div className="w-14 h-14 rounded-[16px] bg-[var(--accent-soft)] flex items-center justify-center">
          <span className="w-7 h-7 rounded-[8px] bg-[var(--accent)]" />
        </div>
        <p className="text-[15px] text-[var(--text-secondary)]">Chọn một ghi chú để bắt đầu</p>
        <p className="text-[12px]">
          hoặc nhấn <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-hover)]">Ctrl N</kbd> để tạo
          ghi chú mới
        </p>
      </div>
    );
  }

  const saveStateLabel =
    saveState === "saving" ? "Đang lưu…" : saveState === "dirty" ? "Chưa lưu" : "Đã lưu";

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[var(--bg)]">
      <div className="px-8 pt-5 pb-2 border-b border-[var(--border)]">
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => {
            if (note && titleDraft.trim() && titleDraft !== note.title) {
              void setTitle(note.id, titleDraft.trim());
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Tiêu đề ghi chú"
          className="w-full text-[26px] font-bold bg-transparent outline-none text-[var(--text)] placeholder:text-[var(--text-faint)]"
        />
        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <TagInput tags={note.tags} onChange={(tags) => void setTags(note.id, tags)} />
          <div className="flex-1" />
          <button
            onClick={() => void setPinned(note.id, !note.pinned)}
            title={note.pinned ? "Bỏ ghim" : "Ghim ghi chú"}
            className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
          >
            {note.pinned ? <Pin size={15} className="text-[var(--accent)]" /> : <PinOff size={15} />}
          </button>
          <span className="text-[11px] text-[var(--text-faint)]">{saveStateLabel}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-8">
        <div ref={editorHost} className="max-w-[820px] mx-auto" />
      </div>
    </div>
  );
}
