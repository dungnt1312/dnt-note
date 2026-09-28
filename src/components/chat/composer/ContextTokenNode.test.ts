import { describe, expect, it } from "vitest";
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $nodesOfType,
  $setSelection,
  createEditor,
  type ElementNode,
  type LexicalEditor,
} from "lexical";
import { $createContextTokenNode, $isContextTokenNode, ContextTokenNode, insertNoteTokenAtCaret } from "./ContextTokenNode";

function setup(text: string, caret: number): LexicalEditor {
  const editor = createEditor({ namespace: "test", nodes: [ContextTokenNode], onError: (e) => { throw e; } });
  editor.update(
    () => {
      const p = $createParagraphNode();
      p.append($createTextNode(text));
      $getRoot().append(p);
      const sel = $createRangeSelection();
      sel.anchor.set(p.getFirstChild()!.getKey(), caret, "text");
      sel.focus.set(p.getFirstChild()!.getKey(), caret, "text");
      $setSelection(sel);
    },
    { discrete: true },
  );
  return editor;
}

const textOf = (editor: LexicalEditor) => editor.getEditorState().read(() => $getRoot().getTextContent());

describe("ContextTokenNode", () => {
  it("serializes and re-imports with payload intact", () => {
    const editor = setup("", 0);
    editor.update(
      () => {
        ($getRoot().getFirstChild() as ElementNode).append(
          $createContextTokenNode({ kind: "note", id: "n1", label: "Roadmap" }),
        );
      },
      { discrete: true },
    );
    const json = JSON.stringify(editor.getEditorState().toJSON());
    const editor2 = createEditor({ namespace: "t", nodes: [ContextTokenNode], onError: (e) => { throw e; } });
    editor2.setEditorState(editor2.parseEditorState(JSON.parse(json)));
    expect(textOf(editor2)).toBe("@Roadmap");
    editor2.getEditorState().read(() => {
      const tokens = $nodesOfType(ContextTokenNode);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].getId()).toBe("n1");
      expect(tokens[0].getKind()).toBe("note");
      expect($isContextTokenNode(tokens[0])).toBe(true);
    });
  });

  it("insertNoteTokenAtCaret replaces the @query with token + space", () => {
    const editor = setup("hi @ro", "hi @ro".length);
    insertNoteTokenAtCaret(editor, { id: "n1", title: "Roadmap Q4" });
    expect(textOf(editor)).toBe("hi @Roadmap Q4 ");
    editor.getEditorState().read(() => {
      expect($nodesOfType(ContextTokenNode)).toHaveLength(1);
    });
  });

  it("insertNoteTokenAtCaret keeps text after the caret", () => {
    const editor = setup("so @ro với cái kia", "so @ro".length);
    insertNoteTokenAtCaret(editor, { id: "n1", title: "Roadmap" });
    expect(textOf(editor)).toBe("so @Roadmap  với cái kia");
  });

  it("insertNoteTokenAtCaret with no query appends a token at the caret", () => {
    const editor = setup("hi ", 3);
    insertNoteTokenAtCaret(editor, { id: "n1", title: "Roadmap" });
    expect(textOf(editor)).toBe("hi @Roadmap ");
  });
});
