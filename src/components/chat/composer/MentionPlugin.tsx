import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  $nodesOfType,
  COMMAND_PRIORITY_CRITICAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  TextNode,
  type LexicalEditor,
} from "lexical";
import { FileText } from "lucide-react";
import { activeTriggerQuery } from "../../../lib/chat/triggers";
import { fuzzyRank } from "../../../lib/fuzzy";
import type { NoteMeta } from "../../../lib/api/notes";
import { useNotesStore } from "../../../lib/store/notesStore";
import { cn } from "../../../lib/utils";
import { ContextTokenNode, insertNoteTokenAtCaret } from "./ContextTokenNode";

/** Fuzzy-rank notes for the popover; already-tokenized notes are excluded. */
export function rankNoteCandidates(notes: NoteMeta[], query: string, excludedIds: string[]): NoteMeta[] {
  return fuzzyRank(notes, query, (n) => `${n.title} ${n.snippet}`)
    .map((r) => r.item)
    .filter((n) => !excludedIds.includes(n.id))
    .slice(0, 8);
}

/**
 * Watches the caret for an active "@query" and renders the note popover.
 * Keyboard: ↑/↓ wrap, Enter/Tab pick, Esc dismiss until the query changes.
 */
export function MentionPlugin({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [editor] = useLexicalComposerContext();
  const notes = useNotesStore((s) => s.notes);
  const [query, setQuery] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const dismissedRef = useRef(false);
  const excludedTick = useRef(0);

  const excludedIds = useMemo(() => {
    void excludedTick.current;
    return editor.getEditorState().read(() => $nodesOfType(ContextTokenNode).map((n) => n.getId()));
  }, [editor, query, excludedTick]);

  const candidates = useMemo(
    () => (query === null || dismissedRef.current ? [] : rankNoteCandidates(notes, query, excludedIds)),
    [query, notes, excludedIds],
  );
  const open = candidates.length > 0;

  useEffect(() => onOpenChange(open), [open, onOpenChange]);

  useEffect(() => {
    excludedTick.current += 1;
  }, [query]);

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel) || !sel.isCollapsed()) {
            setQuery(null);
            return;
          }
          const node = sel.anchor.getNode();
          if (!(node instanceof TextNode)) {
            setQuery(null);
            return;
          }
          const next = activeTriggerQuery(node.getTextContent().slice(0, sel.anchor.offset));
          if (next !== query) dismissedRef.current = false;
          setQuery(next);
        });
      }),
    [editor, query],
  );

  const pick = useCallback(
    (note: NoteMeta) => {
      insertNoteTokenAtCaret(editor, note);
      setQuery(null);
    },
    [editor],
  );

  useEffect(() => {
    if (!open) return;
    const disposers = [
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        () => {
          setCursor((c) => (c + 1) % candidates.length);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        () => {
          setCursor((c) => (c - 1 + candidates.length) % candidates.length);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (e) => {
          e?.preventDefault();
          pick(candidates[cursor]!);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (e) => {
          e?.preventDefault();
          pick(candidates[cursor]!);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          dismissedRef.current = true;
          setQuery(null);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    ];
    return () => disposers.forEach((d) => d());
  }, [editor, open, candidates, cursor, pick]);

  if (!open) return null;
  return (
    <div
      role="listbox"
      id="mention-list"
      aria-label="Chọn ghi chú"
      className="absolute bottom-full left-0 right-0 z-10 mb-2 max-h-[300px] overflow-y-auto rounded-[16px] border border-composer-border bg-popover p-1.5 shadow-popover"
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
          onClick={() => pick(n)}
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
  );
}

export type { LexicalEditor };
