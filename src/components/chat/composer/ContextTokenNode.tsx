import {
  $applyNodeReplacement,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getSelection,
  $getRoot,
  $isParagraphNode,
  $isRangeSelection,
  $setSelection,
  DecoratorNode,
  TextNode,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { FileText, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export type TokenKind = "note" | "skill";
export interface TokenPayload {
  kind: TokenKind;
  id: string;
  label: string;
}
/** Import side keeps Lexical's fields optional; export always writes them. */
export type SerializedContextToken = Spread<TokenPayload, Partial<SerializedLexicalNode>> & { type: string };

/**
 * Atomic inline chip for composer context (note mentions now, skills later).
 * Carries a stable id + label; contributes "@label" to the plain text and
 * survives editor-state serialization (draft persistence).
 */
export class ContextTokenNode extends DecoratorNode<ReactNode> {
  private readonly kind: TokenKind;
  private readonly id: string;
  private readonly label: string;

  constructor(payload: TokenPayload, key?: string) {
    super(key);
    this.kind = payload.kind;
    this.id = payload.id;
    this.label = payload.label;
  }

  static getType(): string {
    return "context-token";
  }

  static clone(node: ContextTokenNode): ContextTokenNode {
    return new ContextTokenNode({ kind: node.kind, id: node.id, label: node.label }, node.__key);
  }

  static importJSON(json: Record<string, unknown>): ContextTokenNode {
    const { kind, id, label } = json as unknown as SerializedContextToken;
    return $createContextTokenNode({ kind, id, label });
  }

  exportJSON(): SerializedContextToken & { version: number } {
    return { type: ContextTokenNode.getType(), version: 1, kind: this.kind, id: this.id, label: this.label };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    return document.createElement("span");
  }

  updateDOM(): false {
    return false;
  }

  isInline(): boolean {
    return true;
  }

  getTextContent(): string {
    return `@${this.label}`;
  }

  getKind(): TokenKind {
    return this.kind;
  }

  getId(): string {
    return this.id;
  }

  getLabel(): string {
    return this.label;
  }

  decorate(): ReactNode {
    const Icon = this.kind === "note" ? FileText : Sparkles;
    return (
      <span
        contentEditable={false}
        data-token-kind={this.kind}
        className="mx-1 inline-flex h-[22px] max-w-[220px] items-center gap-1 rounded-[7px] border border-hairline bg-subtle pl-1.5 pr-2 align-middle text-footnote text-fg"
      >
        <Icon size={11} aria-hidden="true" className="shrink-0 text-fg-secondary" />
        <span className="truncate">{this.label}</span>
      </span>
    );
  }
}

export function $createContextTokenNode(payload: TokenPayload): ContextTokenNode {
  return $applyNodeReplacement(new ContextTokenNode(payload));
}

export function $isContextTokenNode(node: LexicalNode | undefined | null): node is ContextTokenNode {
  return node instanceof ContextTokenNode;
}

/**
 * Replace the active "@query" before the caret with a note token followed by a
 * space, leaving the caret after the space so typing continues naturally.
 */
export function insertNoteTokenAtCaret(editor: LexicalEditor, note: { id: string; title: string }): void {
  editor.update(
    () => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
      const node = sel.anchor.getNode();
      const offset = sel.anchor.offset;
      const before = node instanceof TextNode ? node.getTextContent().slice(0, offset) : "";
      const m = /(?:^|[^A-Za-z0-9_])@([^\s@]*)$/.exec(before);
      const queryLen = m ? m[1].length + 1 : 0; // + "@" itself
      const token = $createContextTokenNode({ kind: "note", id: note.id, label: note.title });
      const space = $createTextNode(" ");

      if (node instanceof TextNode && queryLen > 0) {
        const start = offset - queryLen;
        const tail = node.getTextContent().slice(offset);
        // Cut the "@query" and everything after it; the tail is re-added after
        // the inserted nodes so the token sits exactly where the query was.
        node.spliceText(start, node.getTextContent().length - start, "", true);
        node.insertAfter(token);
        token.insertAfter(space);
        if (tail) space.insertAfter($createTextNode(tail));
      } else if (node instanceof TextNode) {
        // Trigger inserted by button with no query — append at caret.
        node.insertAfter(token);
        token.insertAfter(space);
      } else {
        node.append(token);
        node.append(space);
      }

      const newSel = $createRangeSelection();
      newSel.anchor.set(space.getKey(), 1, "text");
      newSel.focus.set(space.getKey(), 1, "text");
      $setSelection(newSel);
    },
    { discrete: true },
  );
}

/**
 * Append a note token + space at the end of the composer text (used by the
 * right-click "ask AI about this note" flow, where there is no caret yet) and
 * place the selection after the space so typing continues naturally.
 */
export function appendNoteToken(editor: LexicalEditor, note: { id: string; title: string }): void {
  editor.update(
    () => {
      const root = $getRoot();
      const existing = root.getLastChild();
      const p = $isParagraphNode(existing) ? existing : $createParagraphNode();
      if (p !== existing) root.append(p);
      const last = p.getLastDescendant();
      if (last instanceof TextNode && !/\s$/.test(last.getTextContent())) {
        p.append($createTextNode(" "));
      }
      const token = $createContextTokenNode({ kind: "note", id: note.id, label: note.title });
      const space = $createTextNode(" ");
      p.append(token);
      token.insertAfter(space);

      const sel = $createRangeSelection();
      sel.anchor.set(space.getKey(), 1, "text");
      sel.focus.set(space.getKey(), 1, "text");
      $setSelection(sel);
    },
    { discrete: true },
  );
}
