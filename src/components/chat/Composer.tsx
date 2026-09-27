import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ArrowUp, AtSign, FileText, Loader2, Paperclip, Plus, X } from "lucide-react";
import { useChatStore, type ChatFileInput } from "../../lib/store/chatStore";
import { useUi } from "../../lib/store/uiStore";
import { isTauri } from "../../lib/env";
import { ATTACHABLE } from "../../lib/media/extensions";
import {
  CHAT_AUDIO_UNSUPPORTED,
  MAX_CHAT_FILES,
  chatKindOf,
  displayName,
  prepareFromBlob,
  prepareFromPath,
} from "../../lib/media/chatFiles";
import { useNotesStore } from "../../lib/store/notesStore";
import type { NoteMeta } from "../../lib/api/notes";
import { fuzzyRank } from "../../lib/fuzzy";
import { cn, errMsg } from "../../lib/utils";

/** Detects an active @mention query right before the caret. */
export function mentionQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const m = /(?:^|\s)@([^\s@]*)$/.exec(before);
  return m ? m[1] : null;
}

export interface ComposerHandle {
  focus: () => void;
  setText: (text: string) => void;
}

interface ComposerProps {
  placeholder: string;
  compact?: boolean;
}

type Mention = { id: string; title: string };

/** ChatGPT-style composer card: auto-growing textarea, @mention chips, round send button. */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ placeholder, compact }, ref) {
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const status = useChatStore((s) => s.status);
  const notes = useNotesStore((s) => s.notes);
  const selectedId = useNotesStore((s) => s.selectedId);

  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [cursor, setCursor] = useState(0);
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [files, setFiles] = useState<ChatFileInput[]>([]);
  const [preparing, setPreparing] = useState(0);
  const slotsRef = useRef(0);
  slotsRef.current = files.length + preparing;

  /** Queue sources (paths or blobs), enforcing the per-message limit and audio rule. */
  const addSources = (sources: (string | File)[]) => {
    const toast = useUi.getState().pushToast;
    const accepted: (string | File)[] = [];
    for (const src of sources) {
      const name = typeof src === "string" ? src.split(/[\\/]/).pop() ?? src : src.name;
      if (chatKindOf(name) === "audio") {
        toast({ message: CHAT_AUDIO_UNSUPPORTED, durationMs: 4000 });
        continue;
      }
      if (slotsRef.current + accepted.length >= MAX_CHAT_FILES) {
        toast({ message: `Tối đa ${MAX_CHAT_FILES} tệp mỗi tin nhắn`, durationMs: 4000 });
        break;
      }
      accepted.push(src);
    }
    for (const src of accepted) {
      setPreparing((n) => n + 1);
      const job = typeof src === "string" ? prepareFromPath(src) : prepareFromBlob(src);
      job
        .then((f) => setFiles((all) => [...all, f]))
        .catch((e) => toast({ message: `Không đính kèm được: ${e instanceof Error ? e.message : String(e)}`, durationMs: 5000 }))
        .finally(() => setPreparing((n) => n - 1));
    }
  };

  const pickFiles = async () => {
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ multiple: true, filters: [{ name: "Tệp đính kèm", extensions: ATTACHABLE }] });
      const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
      if (paths.length) addSources(paths);
    } catch (e) {
      useUi.getState().pushToast({ message: errMsg(e), durationMs: 5000 });
    }
  };

  const resize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    setText: (text) => {
      setDraft(text);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(text.length, text.length);
        setCaret(text.length);
        resize(el);
      });
    },
  }));

  const query = dismissed ? null : mentionQuery(draft, caret);
  const candidates: NoteMeta[] = useMemo(() => {
    if (query === null) return [];
    return fuzzyRank(notes, query, (n) => `${n.title} ${n.snippet}`)
      .slice(0, 8)
      .map((r) => r.item);
  }, [query, notes]);
  const menuOpen = candidates.length > 0;

  const addMention = (note: Pick<NoteMeta, "id" | "title">) =>
    setMentions((m) => (m.some((x) => x.id === note.id) ? m : [...m, { id: note.id, title: note.title }]));

  const insertMention = (note: NoteMeta) => {
    const before = draft.slice(0, caret).replace(/@([^\s@]*)$/, "");
    const after = draft.slice(caret);
    const next = before + after;
    setDraft(next);
    addMention(note);
    setCursor(0);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
      setCaret(before.length);
    });
  };

  const insertAt = () => {
    const el = textareaRef.current;
    const pos = el?.selectionStart ?? draft.length;
    const needsSpace = pos > 0 && !/\s$/.test(draft.slice(0, pos));
    const next = `${draft.slice(0, pos)}${needsSpace ? " " : ""}@${draft.slice(pos)}`;
    const newCaret = pos + (needsSpace ? 2 : 1);
    setDraft(next);
    setDismissed(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(newCaret, newCaret);
      setCaret(newCaret);
    });
  };

  const canSend = (draft.trim().length > 0 || files.length > 0) && status !== "streaming" && preparing === 0;

  const doSend = async () => {
    const text = draft.trim();
    if ((!text && files.length === 0) || status === "streaming" || preparing > 0) return;
    const pending = mentions;
    const pendingFiles = files;
    setDraft("");
    setMentions([]);
    setFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    const { api } = await import("../../lib/api/notes");
    const resolved = await Promise.all(
      pending.map(async (m) => {
        try {
          const note = await api.notes.read(m.id);
          return { ...m, body: note.body };
        } catch {
          return { ...m, body: "" };
        }
      }),
    );
    await send(text, resolved, pendingFiles);
  };

  const current = notes.find((n) => n.id === selectedId);
  const suggestCurrent = compact && current && !mentions.some((m) => m.id === current.id);

  return (
    <div
      className="relative rounded-xl border border-composer-border bg-composer p-2.5 shadow-[0_3px_10px_rgba(0,0,0,0.06)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          textareaRef.current?.focus();
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        const dropped = Array.from(e.dataTransfer.files);
        if (!dropped.length) return;
        e.preventDefault();
        e.stopPropagation();
        addSources(dropped);
      }}
    >
      {menuOpen && (
        <div
          role="listbox"
          id="mention-list"
          aria-label="Chọn ghi chú"
          className="absolute bottom-full left-0 right-0 mb-2 max-h-[300px] overflow-y-auto rounded-[16px] border border-composer-border bg-popover p-1.5 shadow-popover"
        >
          <div className="px-2.5 pb-1 pt-1 text-caption font-medium text-fg-secondary">Nhắc tới ghi chú</div>
          {candidates.map((n, i) => (
            <button
              key={n.id}
              type="button"
              role="option"
              aria-selected={i === cursor}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setCursor(i)}
              onClick={() => insertMention(n)}
              className={cn(
                "flex h-11 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left",
                i === cursor && "bg-hover",
              )}
            >
              <FileText size={14} aria-hidden="true" className="shrink-0 text-fg-secondary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-callout font-medium text-fg">{n.title}</span>
                <span className="block truncate text-caption text-fg-secondary">{n.snippet || "Chưa có nội dung"}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {mentions.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
          {mentions.map((m) => (
            <span
              key={m.id}
              className="inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-[10px] border border-composer-border bg-control pl-2 pr-1 text-footnote text-fg"
            >
              <FileText size={12} aria-hidden="true" className="shrink-0 text-fg-secondary" />
              <span className="truncate">{m.title}</span>
              <button
                type="button"
                aria-label={`Bỏ đính kèm ${m.title}`}
                onClick={() => setMentions((all) => all.filter((x) => x.id !== m.id))}
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-fg-tertiary hover:bg-hover hover:text-fg"
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {(files.length > 0 || preparing > 0) && (
        <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
          {files.map((f) => (
            <span
              key={f.name}
              className="inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-[10px] border border-composer-border bg-control pl-2 pr-1 text-footnote text-fg"
            >
              {f.kind === "image" && f.dataUrl ? (
                <img src={f.dataUrl} alt="" className="size-4 shrink-0 rounded object-cover" />
              ) : (
                <FileText size={12} aria-hidden="true" className="shrink-0 text-fg-secondary" />
              )}
              <span className="truncate">{displayName(f.name)}</span>
              <button
                type="button"
                aria-label={`Bỏ tệp ${displayName(f.name)}`}
                onClick={() => setFiles((all) => all.filter((x) => x.name !== f.name))}
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-fg-tertiary hover:bg-hover hover:text-fg"
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
          {Array.from({ length: preparing }, (_, i) => (
            <span
              key={`prep-${i}`}
              role="status"
              aria-label="Đang chuẩn bị tệp"
              className="inline-flex h-7 items-center gap-1.5 rounded-[10px] border border-composer-border bg-control px-2 text-footnote text-fg-secondary"
            >
              <Loader2 size={12} aria-hidden="true" className="animate-spin" />
              Đang chuẩn bị…
            </span>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={draft}
        rows={1}
        aria-label="Tin nhắn cho trợ lý"
        aria-autocomplete="list"
        aria-controls={menuOpen ? "mention-list" : undefined}
        aria-expanded={menuOpen}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setDismissed(false);
          setCursor(0);
          resize(e.target);
        }}
        onPaste={(e) => {
          const pasted = Array.from(e.clipboardData.files);
          if (!pasted.length) return;
          e.preventDefault();
          addSources(pasted);
        }}
        onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (menuOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setCursor((c) =>
              e.key === "ArrowDown" ? (c + 1) % candidates.length : (c - 1 + candidates.length) % candidates.length,
            );
            return;
          }
          if (menuOpen && (e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
            e.preventDefault();
            insertMention(candidates[cursor]);
            return;
          }
          if (menuOpen && e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDismissed(true);
            return;
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void doSend();
          }
        }}
        className="block max-h-[200px] w-full resize-none bg-transparent px-2 py-1.5 text-body text-fg outline-none"
      />

      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          aria-label="Nhắc tới ghi chú (@)"
          title="Nhắc tới ghi chú (@)"
          onClick={insertAt}
          className="flex size-[34px] items-center justify-center rounded-full text-fg transition-colors hover:bg-composer-hover"
        >
          <AtSign size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {isTauri && (
          <button
            type="button"
            aria-label="Đính kèm tệp"
            title="Đính kèm ảnh hoặc tài liệu"
            onClick={() => void pickFiles()}
            className="flex size-[34px] items-center justify-center rounded-full text-fg transition-colors hover:bg-composer-hover"
          >
            <Paperclip size={17} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
        {suggestCurrent && current && (
          <button
            type="button"
            onClick={() => addMention(current)}
            title="Đính kèm ghi chú đang mở"
            className="inline-flex h-7 max-w-[170px] items-center gap-1 rounded-full border border-dashed border-composer-border px-2.5 text-footnote font-medium text-fg-secondary transition-colors hover:bg-composer-hover"
          >
            <Plus size={11} strokeWidth={2.5} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{current.title}</span>
          </button>
        )}
        <div className="flex-1" />
        {status === "streaming" ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Dừng tạo câu trả lời"
            title="Dừng"
            className="flex size-[34px] items-center justify-center rounded-full bg-accent transition-colors hover:bg-accent-hover"
          >
            <span aria-hidden="true" className="size-[11px] rounded-[2.5px] bg-accent-fg" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void doSend()}
            disabled={!canSend}
            aria-label="Gửi (Enter)"
            title="Gửi (Enter) · Shift+Enter để xuống dòng"
            className={cn(
              "flex size-[34px] items-center justify-center rounded-full transition-colors",
              canSend ? "bg-accent text-accent-fg hover:bg-accent-hover" : "bg-send-disabled text-send-disabled-fg",
            )}
          >
            <ArrowUp size={17} strokeWidth={2.5} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
});

