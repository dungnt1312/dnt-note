import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import {
  $createLineBreakNode,
  $createRangeSelection,
  $getSelection,
  $isRangeSelection,
  $getRoot,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  ElementNode,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  TextNode,
  type LexicalNode,
  type EditorState,
  type LexicalEditor,
  type PasteCommandType,
} from "lexical";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { ContextTokenNode } from "./ContextTokenNode";

const PASTE_TO_ATTACHMENT_CHARS = 2000;

export interface ChatInputProps {
  placeholder: string;
  initialEditorJson?: string | null;
  onChange: (editorJson: string, text: string) => void;
  onSubmit: () => void;
  onFilesPaste: (files: File[]) => void;
  /** Return true when the long text was converted to an attachment. */
  onLongTextPaste: (text: string) => boolean;
  onReady: (editor: LexicalEditor) => void;
  /** Shared with MentionPlugin so Enter can be claimed by the popover. */
  menuOpenRef: { current: boolean };
  children?: ReactNode;
}

function BehaviorPlugin({
  onSubmit,
  onFilesPaste,
  onLongTextPaste,
  menuOpenRef,
}: Pick<ChatInputProps, "onSubmit" | "onFilesPaste" | "onLongTextPaste" | "menuOpenRef">) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event || event.isComposing || event.keyCode === 229) return false;
        if (menuOpenRef.current) return false; // the popover consumes Enter first
        if (event.shiftKey) {
          editor.update(() => {
            const sel = $getSelection();
            if ($isRangeSelection(sel)) sel.insertNodes([$createLineBreakNode()]);
          });
          return true;
        }
        event.preventDefault();
        onSubmit();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onSubmit, menuOpenRef]);

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: PasteCommandType) => {
        if (!event || !("clipboardData" in event)) return false;
        const clip = event as ClipboardEvent;
        const files = Array.from(clip.clipboardData?.files ?? []);
        if (files.length > 0) {
          event.preventDefault();
          onFilesPaste(files);
          return true;
        }
        const text = clip.clipboardData?.getData("text/plain") ?? "";
        if (text.trim().length > PASTE_TO_ATTACHMENT_CHARS && onLongTextPaste(text)) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onFilesPaste, onLongTextPaste]);

  // Backspace next to a token removes the WHOLE token — a half-glanced chip
  // (e.g. only its trailing space deleted) must not be reachable.
  useEffect(() => {
    return editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event: KeyboardEvent) => {
        if (event.isComposing) return false;
        let handled = false;
        editor.getEditorState().read(() => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
          const node = sel.anchor.getNode();
          const offset = sel.anchor.offset;
          let target: LexicalNode | null = null;
          if (node instanceof ContextTokenNode) {
            target = node;
          } else if (node instanceof TextNode) {
            if (offset === 0) target = node.getPreviousSibling();
          } else if (node instanceof ElementNode) {
            target = node.getChildAtIndex(offset - 1);
          }
          if (target instanceof ContextTokenNode) handled = true;
        });
        if (!handled) return false;
        event.preventDefault();
        editor.update(() => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
          const node = sel.anchor.getNode();
          const offset = sel.anchor.offset;
          let target: LexicalNode | null = null;
          if (node instanceof ContextTokenNode) {
            target = node;
          } else if (node instanceof TextNode) {
            if (offset === 0) target = node.getPreviousSibling();
          } else if (node instanceof ElementNode) {
            target = node.getChildAtIndex(offset - 1);
          }
          if (target instanceof ContextTokenNode) {
            const prev = target.getPreviousSibling();
            target.remove();
            // Anchor caret where the token was: on the preceding text node end.
            if (prev instanceof TextNode) {
              const newSel = $createRangeSelection();
              const len = prev.getTextContent().length;
              newSel.anchor.set(prev.getKey(), len, "text");
              newSel.focus.set(prev.getKey(), len, "text");
              $setSelection(newSel);
            }
          }
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}

function ReadyPlugin({ onReady }: { onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  const done = useRef(false);
  useEffect(() => {
    if (!done.current) {
      done.current = true;
      onReady(editor);
    }
  }, [editor, onReady]);
  return null;
}

/** Lexical-based chat input: plain text + atomic context tokens. */
export function ChatInput(props: ChatInputProps) {
  const initialConfig = useMemo(
    () => ({
      namespace: "ChatInput",
      nodes: [ContextTokenNode],
      onError: (e: Error) => console.error("[ChatInput]", e),
      editorState: props.initialEditorJson
        ? (editor: LexicalEditor) => {
            editor.setEditorState(editor.parseEditorState(props.initialEditorJson!));
          }
        : undefined,
    }),
    // Initial editor state must be captured once — later changes flow through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              className="block max-h-[200px] min-h-[52px] w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-2 py-1.5 text-body text-fg outline-none"
              aria-label="Tin nhắn cho trợ lý"
            />
          }
          placeholder={
            <div className="pointer-events-none absolute inset-x-2 top-1.5 select-none text-body text-fg-tertiary">
              {props.placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <BehaviorPlugin
          onSubmit={props.onSubmit}
          onFilesPaste={props.onFilesPaste}
          onLongTextPaste={props.onLongTextPaste}
          menuOpenRef={props.menuOpenRef}
        />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(editorState: EditorState) => {
            const text = editorState.read(() => $getRoot().getTextContent());
            props.onChange(JSON.stringify(editorState.toJSON()), text);
          }}
        />
        <ReadyPlugin onReady={props.onReady} />
        {props.children}
      </div>
    </LexicalComposer>
  );
}
