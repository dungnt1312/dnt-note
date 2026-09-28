import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
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
import { useT } from "../../../lib/i18n";
import type { MentionInput } from "../../../lib/chat/payload";
import { cn } from "../../../lib/utils";
import { ChatInput } from "./ChatInput";
import { MentionPlugin } from "./MentionPlugin";
import { AttachmentTray } from "./AttachmentTray";
import { ContextTokenNode, appendNoteToken } from "./ContextTokenNode";

export interface ComposerHandle {
  focus: () => void;
  setText: (text: string) => void;
}

interface ComposerProps {
  placeholder: string;
  compact?: boolean;
}

const DIALOG_FILTER_EXTENSIONS = [
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "pdf", "docx", "rtf", "odt",
  "txt", "md", "csv", "json", "rs", "py", "js", "ts", "tsx", "jsx", "go",
  "java", "c", "cpp", "html", "css", "toml", "yaml", "yml", "xml", "sh",
];

/**
 * ZCode-style composer shell: inline @note tokens in the editor, attachments in
 * a tray, paperclip/@ toolbar, and a safe send that only clears the draft after
 * the store accepts the message.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ placeholder }, ref) {
  const t = useT();
  const chatId = useChatStore((s) => s.chatId);
  const status = useChatStore((s) => s.status);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const draft = useComposerStore((s) => s.drafts[chatId]);
  const setEditorState = useComposerStore((s) => s.setEditorState);
  const addFiles = useComposerStore((s) => s.addAttachmentFiles);
  const addPaths = useComposerStore((s) => s.addAttachmentPaths);
  const removeAttachment = useComposerStore((s) => s.removeAttachment);
  const consumeSentDraft = useComposerStore((s) => s.consumeSentDraft);
  const restoreDraftAttachments = useComposerStore((s) => s.restoreDraftAttachments);

  const editorRef = useRef<LexicalEditor | null>(null);
  const menuOpenRef = useRef(false);
  const preparingSendRef = useRef(false);
  const [preparingSend, setPreparingSend] = useState(false);
  const [text, setTextState] = useState(draft?.text ?? "");

  const needsDraftRestore = draft?.attachments.some(
    (a) => a.status === "ready" && (!a.name || (a.kind === "image" ? !a.previewUrl : a.text === undefined)),
  ) ?? false;

  useEffect(() => {
    if (needsDraftRestore) void restoreDraftAttachments(chatId);
  }, [chatId, needsDraftRestore, restoreDraftAttachments]);

  const pendingContext = useComposerStore((s) => s.pendingContext);
  const takeChatContext = useComposerStore((s) => s.takeChatContext);
  const addSnippet = useComposerStore((s) => s.addSnippet);

  // One-shot handoff from the note editor's right-click menu: a snippet becomes
  // a stored document attachment, a note becomes an @token; then focus the composer.
  useEffect(() => {
    if (!pendingContext) return;
    const ctx = takeChatContext();
    if (!ctx) return;
    if (ctx.kind === "snippet") {
      void addSnippet(chatId, { originalName: ctx.title, text: ctx.text });
    } else if (editorRef.current) {
      appendNoteToken(editorRef.current, { id: ctx.noteId, title: ctx.title });
    }
    editorRef.current?.focus();
  }, [pendingContext, chatId, takeChatContext, addSnippet]);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    setText: (text: string) => {
      setTextState(text);
      editorRef.current?.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append($createTextNode(text));
          root.append(p);
          const sel = $createRangeSelection();
          const last = p.getLastDescendant() ?? p;
          if (last instanceof TextNode) {
            sel.anchor.set(last.getKey(), text.length, "text");
            sel.focus.set(last.getKey(), text.length, "text");
          }
          $setSelection(sel);
        },
        { discrete: true },
      );
      requestAnimationFrame(() => editorRef.current?.focus());
    },
  }));

  const ready = draft?.attachments.filter((a) => a.status === "ready") ?? [];
  const hasImporting = draft?.attachments.some((a) => a.status === "importing") ?? false;
  const errorCount = draft?.attachments.filter((a) => a.status === "error").length ?? 0;
  const canSend =
    (text.trim().length > 0 || ready.length > 0)
    && !hasImporting
    && !preparingSend
    && !needsDraftRestore
    && status !== "streaming";

  const doSend = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || status === "streaming" || hasImporting || needsDraftRestore || preparingSendRef.current) return;
    preparingSendRef.current = true;
    setPreparingSend(true);
    try {
      const tokens = editor.getEditorState().read(() =>
        $nodesOfType(ContextTokenNode).map((n) => ({ kind: n.getKind(), id: n.getId(), label: n.getLabel() })),
      );
      const editorState = editor.getEditorState();
      const editorJson = JSON.stringify(editorState.toJSON());
      const editorText = editorState.read(() => $getRoot().getTextContent());
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
      for (const tok of tokens.filter((tk) => tk.kind === "note")) {
        if (seen.has(tok.id)) continue;
        seen.add(tok.id);
        try {
          const note = await notesApi.notes.read(tok.id);
          mentions.push({ id: tok.id, title: tok.label, body: note.body });
        } catch {
          mentions.push({ id: tok.id, title: tok.label, body: "", failed: true });
        }
      }

      const currentEditorState = editor.getEditorState();
      const currentEditorJson = JSON.stringify(currentEditorState.toJSON());
      const currentEditorText = currentEditorState.read(() => $getRoot().getTextContent());
      const currentDraft = useComposerStore.getState().drafts[chatId];
      const currentReadyIds = currentDraft?.attachments.filter((a) => a.status === "ready").map((a) => a.id) ?? [];
      const sentIds = attachments.map((a) => a.id);
      if (
        useChatStore.getState().chatId !== chatId
        || currentEditorJson !== editorJson
        || currentEditorText !== editorText
        || currentDraft?.attachments.some((a) => a.status === "importing")
        || currentReadyIds.length !== sentIds.length
        || currentReadyIds.some((id, index) => id !== sentIds[index])
      ) return;

      let consumed = false;
      const consumeAcceptedDraft = () => {
        consumed = true;
        const latestEditorState = editor.getEditorState();
        const latestText = latestEditorState.read(() => $getRoot().getTextContent());
        const editorUnchanged = JSON.stringify(latestEditorState.toJSON()) === editorJson && latestText === editorText;
        consumeSentDraft(chatId, { editorJson, text: editorText, attachmentIds: sentIds });
        if (editorUnchanged && useChatStore.getState().chatId === chatId) {
          editor.update(
            () => {
              const root = $getRoot();
              root.clear();
              root.append($createParagraphNode());
            },
            { discrete: true },
          );
          setTextState("");
        }
      };
      const result = await send({ text: editorText, mentions, attachments }, undefined, consumeAcceptedDraft);
      if (result.ok && !consumed) consumeAcceptedDraft();
      // Rejected → keep the draft; the store error banner explains why.
    } finally {
      preparingSendRef.current = false;
      setPreparingSend(false);
    }
  }, [chatId, ready, send, status, hasImporting, needsDraftRestore, consumeSentDraft]);

  const attach = useCallback(async () => {
    const picked = await openFileDialog({
      multiple: true,
      filters: [{ name: t("chat.attachFilterName"), extensions: DIALOG_FILTER_EXTENSIONS }],
    });
    if (!picked) return;
    await addPaths(chatId, Array.isArray(picked) ? picked : [picked]);
  }, [chatId, addPaths, t]);

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

  const contextSummary = ready.length > 0 ? t("chat.contextFileCount", { n: ready.length }) : null;

  return (
    <div className="relative rounded-xl border border-composer-border bg-composer p-2.5 shadow-[0_3px_10px_rgba(0,0,0,0.06)]">
      <AttachmentTray items={draft?.attachments ?? []} onRemove={(id) => removeAttachment(chatId, id)} />
      <ChatInput
        placeholder={placeholder}
        initialEditorJson={draft?.editorJson ?? null}
        onChange={(json, text) => {
          setTextState(text);
          setEditorState(chatId, json, text);
        }}
        onSubmit={() => void doSend()}
        onFilesPaste={(files) => void addFiles(chatId, files)}
        onLongTextPaste={(pasted) => {
          void addFiles(chatId, [
            new File([new TextEncoder().encode(pasted)], t("chat.pastedTextFileName"), { type: "text/plain" }),
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
          aria-label={t("chat.attachFile")}
          title={t("chat.attachFile")}
          onClick={() => void attach()}
          className="flex size-[34px] items-center justify-center rounded-full text-fg transition-colors hover:bg-composer-hover"
        >
          <Paperclip size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t("chat.mentionNote")}
          title={t("chat.mentionNote")}
          onClick={insertAt}
          className="flex size-[34px] items-center justify-center rounded-full text-fg transition-colors hover:bg-composer-hover"
        >
          <AtSign size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {contextSummary && <span className="ml-1 text-caption text-fg-tertiary">{contextSummary}</span>}
        {errorCount > 0 && <span className="ml-1 text-caption text-danger">{t("chat.errorFileCount", { n: errorCount })}</span>}
        <div className="flex-1" />
        {status === "streaming" ? (
          <button
            type="button"
            onClick={stop}
            aria-label={t("chat.stopGenerating")}
            title={t("chat.stop")}
            className="flex size-[34px] items-center justify-center rounded-full bg-accent transition-colors hover:bg-accent-hover"
          >
            <span aria-hidden="true" className="size-[11px] rounded-[2.5px] bg-accent-fg" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void doSend()}
            disabled={!canSend}
            aria-label={t("chat.send")}
            title={t("chat.sendHint")}
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
