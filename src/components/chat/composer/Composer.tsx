import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { ArrowUp, AtSign, Paperclip } from "lucide-react";
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getSelection,
  $getRoot,
  $isRangeSelection,
  $nodesOfType,
  $setSelection,
  TextNode,
  type LexicalEditor,
} from "lexical";
import { useChatStore } from "../../../lib/store/chatStore";
import { useComposerStore } from "../../../lib/store/composerStore";
import { api as notesApi } from "../../../lib/api/notes";
import type { MentionInput } from "../../../lib/chat/payload";
import { cn } from "../../../lib/utils";
import { ChatInput } from "./ChatInput";
import { MentionPlugin } from "./MentionPlugin";
import { AttachmentTray } from "./AttachmentTray";
import { ContextTokenNode } from "./ContextTokenNode";

export interface ComposerHandle {
  focus: () => void;
  setText: (text: string) => void;
}

interface ComposerProps {
  placeholder: string;
  compact?: boolean;
}

const DIALOG_FILTERS = [
  {
    name: "Đính kèm",
    extensions: [
      "png", "jpg", "jpeg", "gif", "webp", "bmp", "pdf", "docx", "rtf", "odt",
      "txt", "md", "csv", "json", "rs", "py", "js", "ts", "tsx", "jsx", "go",
      "java", "c", "cpp", "html", "css", "toml", "yaml", "yml", "xml", "sh",
    ],
  },
];

/**
 * ZCode-style composer shell: inline @note tokens in the editor, attachments in
 * a tray, paperclip/@ toolbar, and a safe send that only clears the draft after
 * the store accepts the message.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ placeholder }, ref) {
  const chatId = useChatStore((s) => s.chatId);
  const status = useChatStore((s) => s.status);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const draft = useComposerStore((s) => s.drafts[chatId]);
  const setEditorState = useComposerStore((s) => s.setEditorState);
  const addFiles = useComposerStore((s) => s.addAttachmentFiles);
  const addPaths = useComposerStore((s) => s.addAttachmentPaths);
  const removeAttachment = useComposerStore((s) => s.removeAttachment);
  const clearDraft = useComposerStore((s) => s.clearDraft);

  const editorRef = useRef<LexicalEditor | null>(null);
  const menuOpenRef = useRef(false);
  const [text, setTextState] = useState(draft?.text ?? "");

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    setText: (t: string) => {
      setTextState(t);
      editorRef.current?.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append($createTextNode(t));
          root.append(p);
          const sel = $createRangeSelection();
          const last = p.getLastDescendant() ?? p;
          if (last instanceof TextNode) {
            sel.anchor.set(last.getKey(), t.length, "text");
            sel.focus.set(last.getKey(), t.length, "text");
          }
          $setSelection(sel);
        },
        { discrete: true },
      );
      requestAnimationFrame(() => editorRef.current?.focus());
    },
  }));

  const ready = draft?.attachments.filter((a) => a.status === "ready") ?? [];
  const errorCount = draft?.attachments.filter((a) => a.status === "error").length ?? 0;
  const canSend = (text.trim().length > 0 || ready.length > 0) && status !== "streaming";

  const doSend = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || status === "streaming") return;
    const tokens = editor.getEditorState().read(() =>
      $nodesOfType(ContextTokenNode).map((n) => ({ kind: n.getKind(), id: n.getId(), label: n.getLabel() })),
    );
    const editorText = editor.getEditorState().read(() => $getRoot().getTextContent());
    const attachments = ready.map(({ id, name, originalName, size, kind, text: at, previewUrl }) => ({
      id,
      name,
      originalName,
      size,
      kind,
      text: at,
      previewUrl,
    }));
    if (!editorText.trim() && attachments.length === 0) return;

    const seen = new Set<string>();
    const mentions: MentionInput[] = [];
    for (const t of tokens.filter((t) => t.kind === "note")) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      try {
        const note = await notesApi.notes.read(t.id);
        mentions.push({ id: t.id, title: t.label, body: note.body });
      } catch {
        mentions.push({ id: t.id, title: t.label, body: "", failed: true });
      }
    }

    const result = await send({ text: editorText, mentions, attachments });
    if (result.ok) {
      // Clear the editor first — its onChange writes an empty draft — then drop
      // the draft entry entirely so nothing lingers for this chat.
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          root.append($createParagraphNode());
        },
        { discrete: true },
      );
      clearDraft(chatId);
      setTextState("");
    }
    // Rejected → keep the draft; the store error banner explains why.
  }, [chatId, ready, send, status, clearDraft]);

  const attach = useCallback(async () => {
    const picked = await openFileDialog({ multiple: true, filters: DIALOG_FILTERS });
    if (!picked) return;
    await addPaths(chatId, Array.isArray(picked) ? picked : [picked]);
  }, [chatId, addPaths]);

  const insertAt = useCallback(() => {
    editorRef.current?.focus();
    editorRef.current?.update(() => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
      const node = sel.anchor.getNode();
      const needsSpace =
        node instanceof TextNode && sel.anchor.offset > 0 && !/\s$/.test(node.getTextContent().slice(0, sel.anchor.offset));
      sel.insertText(needsSpace ? " @" : "@");
    });
  }, []);

  const contextSummary = ready.length > 0 ? `${ready.length} file` : null;

  return (
    <div className="relative rounded-xl border border-composer-border bg-composer p-2.5 shadow-[0_3px_10px_rgba(0,0,0,0.06)]">
      <AttachmentTray items={draft?.attachments ?? []} onRemove={(id) => removeAttachment(chatId, id)} />
      <ChatInput
        placeholder={placeholder}
        initialEditorJson={draft?.editorJson ?? null}
        onChange={(json, t) => {
          setTextState(t);
          setEditorState(chatId, json, t);
        }}
        onSubmit={() => void doSend()}
        onFilesPaste={(files) => void addFiles(chatId, files)}
        onLongTextPaste={(t) => {
          void addFiles(chatId, [
            new File([new TextEncoder().encode(t)], "van-ban-da-dan.txt", { type: "text/plain" }),
          ]);
          return true;
        }}
        onReady={(e) => {
          editorRef.current = e;
        }}
        menuOpenRef={menuOpenRef}
      >
        <MentionPlugin
          onOpenChange={(open) => {
            menuOpenRef.current = open;
          }}
        />
      </ChatInput>
      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          aria-label="Đính kèm file"
          title="Đính kèm file"
          onClick={() => void attach()}
          className="flex size-[34px] items-center justify-center rounded-full text-fg transition-colors hover:bg-composer-hover"
        >
          <Paperclip size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Nhắc tới ghi chú (@)"
          title="Nhắc tới ghi chú (@)"
          onClick={insertAt}
          className="flex size-[34px] items-center justify-center rounded-full text-fg transition-colors hover:bg-composer-hover"
        >
          <AtSign size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {contextSummary && <span className="ml-1 text-caption text-fg-tertiary">{contextSummary}</span>}
        {errorCount > 0 && <span className="ml-1 text-caption text-danger">{errorCount} file lỗi</span>}
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
