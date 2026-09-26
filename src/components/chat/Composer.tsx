import { useMemo, useRef, useState } from "react";
import { ArrowUp, Square, AtSign } from "lucide-react";
import { useChatStore } from "../../lib/store/chatStore";
import { useNotesStore } from "../../lib/store/notesStore";
import type { NoteMeta } from "../../lib/api/notes";
import { fuzzyRank } from "../../lib/fuzzy";
import { cn } from "../../lib/utils";

/** Detects an active @mention query right before the caret. */
export function mentionQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const m = /(?:^|\s)@([^\s@]*)$/.exec(before);
  return m ? m[1] : null;
}

export function Composer({ disabled }: { disabled: boolean }) {
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const status = useChatStore((s) => s.status);
  const notes = useNotesStore((s) => s.notes);

  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<{ id: string; title: string; body: string }[]>([]);
  const [mentionCursor, setMentionCursor] = useState(0);
  const [caret, setCaret] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const query = mentionQuery(draft, caret);
  const candidates: NoteMeta[] = useMemo(() => {
    if (query === null) return [];
    return fuzzyRank(notes, query ?? "", (n) => `${n.title} ${n.snippet}`)
      .slice(0, 8)
      .map((r) => r.item);
  }, [query, notes]);

  const insertMention = (note: NoteMeta) => {
    const before = draft.slice(0, caret);
    const after = draft.slice(caret);
    const cleaned = before.replace(/@([^\s@]*)$/, `@${note.title} `);
    setDraft(cleaned + after);
    setMentions((m) => (m.some((x) => x.id === note.id) ? m : [...m, { id: note.id, title: note.title, body: "" }]));
    // body fetched on send (notes store has no body) — pull from read on send time
    textareaRef.current?.focus();
  };

  const doSend = async () => {
    const text = draft.trim();
    if (!text || status === "streaming") return;
    setDraft("");
    setMentions([]);
    // Resolve mention bodies at send time.
    const resolved = await Promise.all(
      mentions.map(async (m) => {
        if (m.body) return m;
        try {
          const { api } = await import("../../lib/api/notes");
          const note = await api.notes.read(m.id);
          return { ...m, body: note.body };
        } catch {
          return m;
        }
      }),
    );
    await send(text, resolved);
  };

  return (
    <div className="relative border-t border-[var(--border)] p-2.5">
      {candidates.length > 0 && (
        <div className="absolute bottom-full left-2.5 right-2.5 mb-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-lg overflow-hidden">
          {candidates.map((n, i) => (
            <button
              key={n.id}
              onClick={() => insertMention(n)}
              className={cn(
                "w-full text-left px-3 py-1.5 text-[12.5px] flex items-center gap-2",
                i === mentionCursor ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--bg-hover)]",
              )}
            >
              <AtSign size={11} className="text-[var(--text-faint)]" />
              <span className="truncate text-[var(--text)]">{n.title}</span>
              <span className="ml-auto truncate text-[11px] text-[var(--text-faint)] max-w-[140px]">
                {n.snippet}
              </span>
            </button>
          ))}
        </div>
      )}

      {mentions.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-1.5">
          {mentions.map((m) => (
            <span key={m.id} className="text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
              @{m.title}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={draft}
          rows={1}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
          }}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (candidates.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setMentionCursor((c) =>
                e.key === "ArrowDown"
                  ? Math.min(c + 1, candidates.length - 1)
                  : Math.max(c - 1, 0),
              );
              return;
            }
            if (candidates.length > 0 && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              insertMention(candidates[mentionCursor]);
              return;
            }
            if (e.key === "Escape" && candidates.length > 0) {
              setMentionCursor(0);
              setDraft(draft.replace(/@([^\s@]*)$/, ""));
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void doSend();
            }
          }}
          placeholder="Hỏi trợ lý AI… (@ để đính kèm note, Enter để gửi)"
          className="flex-1 resize-none max-h-[140px] px-3 py-2 text-[13px] rounded-[var(--radius-md)] bg-[var(--bg-elevated)] border border-[var(--border)] outline-none focus:border-[var(--accent)] text-[var(--text)] placeholder:text-[var(--text-faint)]"
        />
        {status === "streaming" ? (
          <button
            onClick={stop}
            title="Dừng"
            className="p-2.5 rounded-[var(--radius-md)] bg-[var(--bg-hover)] text-[var(--text)] hover:opacity-80"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            onClick={() => void doSend()}
            disabled={!draft.trim() || disabled}
            title="Gửi (Enter)"
            className="p-2.5 rounded-[var(--radius-md)] bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90"
          >
            <ArrowUp size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
