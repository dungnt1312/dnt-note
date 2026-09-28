# Editor Right-click "Gửi vào Trợ lý AI" Implementation Plan

> Historical plan note: the original virtual/no-file snippet steps below were superseded by `docs/superpowers/specs/2026-09-27-multimodal-chat-history-design.md`. Current snippets are materialized as stored `chat-snippet.md` attachments so their context survives chat reloads.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuột phải trong note editor → menu tại con trỏ → đẩy đoạn chọn (attachment ảo) hoặc cả note (token @note) vào composer của Trợ lý AI; user tự gõ prompt.

**Architecture:** Menu ngữ cảnh portal `position: fixed` tái dùng `MenuItem` của `ui/Menu.tsx` qua chung `MenuContext`. Cầu NoteEditor→Composer là state `pendingContext` trong `composerStore` (2 cây component anh em); đoạn chọn đi vào chat như attachment ảo `{originalName, text}` (không ghi file — `buildRequestUserMessage` chỉ cần hai trường này), cả note đi vào như `ContextTokenNode` có sẵn.

**Tech Stack:** React 19, CodeMirror 6, Lexical 0.51, zustand 5, vitest + RTL (jsdom), Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-27-editor-context-menu-to-ai-design.md`

## Global Constraints

- Không thêm dependency mới; không sửa Rust/backend, `chatStore`, `payload.ts`.
- Copy UI tiếng Việt, khớp tone hiện có ("Gửi vào Trợ lý AI", "Sao chép", "Hỏi AI về ghi chú này").
- TS strict; logic thuần tách file riêng để test không mount editor.
- Test co-located `*.test.ts(x)` cạnh source; mock Tauri tại `@tauri-apps/api/core`.
- Commit theo task: `feat(scope): ...` (như git log hiện có).
- Không tự gửi tin nhắn AI — chỉ đính kèm ngữ cảnh + focus composer.

---

### Task 1: Selection helper (thuần, CM6)

**Files:**
- Create: `src/lib/editor/selection.ts`
- Test: `src/lib/editor/selection.test.ts`

**Interfaces:**
- Consumes: `EditorState` từ `@codemirror/state`.
- Produces: `getSelectionInfo(state: EditorState): SelectionInfo` với `SelectionInfo = { from: number; to: number; text: string; hasSelection: boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/editor/selection.test.ts
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { getSelectionInfo } from "./selection";

const stateOf = (doc: string, anchor: number, head: number) =>
  EditorState.create({ doc, selection: { anchor, head } });

describe("getSelectionInfo", () => {
  it("collapsed caret → hasSelection false, empty text", () => {
    const info = getSelectionInfo(stateOf("hello world", 3, 3));
    expect(info).toEqual({ from: 3, to: 3, text: "", hasSelection: false });
  });

  it("returns the selected text", () => {
    const info = getSelectionInfo(stateOf("hello world", 0, 5));
    expect(info).toEqual({ from: 0, to: 5, text: "hello", hasSelection: true });
  });

  it("normalizes a reversed selection (head before anchor)", () => {
    const info = getSelectionInfo(stateOf("hello world", 5, 0));
    expect(info).toEqual({ from: 0, to: 5, text: "hello", hasSelection: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/editor/selection.test.ts`
Expected: FAIL — không resolve được `./selection` (chưa tồn tại).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/editor/selection.ts
import type { EditorState } from "@codemirror/state";

export interface SelectionInfo {
  from: number;
  to: number;
  text: string;
  hasSelection: boolean;
}

/** Selection snapshot of the note editor at right-click time. */
export function getSelectionInfo(state: EditorState): SelectionInfo {
  const range = state.selection.main;
  return {
    from: range.from,
    to: range.to,
    text: state.sliceDoc(range.from, range.to),
    hasSelection: !range.empty,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/editor/selection.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/selection.ts src/lib/editor/selection.test.ts
git commit -m "feat(editor): pure CM6 selection info helper"
```

---

### Task 2: ContextMenu portal component

**Files:**
- Modify: `src/components/ui/Menu.tsx` (export `MenuContext`, export selector `ITEMS`)
- Create: `src/components/ui/ContextMenu.tsx`
- Test: `src/components/ui/ContextMenu.test.tsx`

**Interfaces:**
- Consumes: `MenuContext` (trong Menu.tsx, hiện private — cần `export`), selector item `[role^=menuitem]:not([disabled])`.
- Produces: `ContextMenu({ x, y, onClose, children })` — portal fixed tại (x, y), provide `MenuContext` với `close = onClose`; children dùng `MenuItem`/`MenuSeparator` như `Menu`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ui/ContextMenu.test.tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ContextMenu } from "./ContextMenu";
import { MenuItem } from "./Menu";

const Harness = ({ onClose, onSelect }: { onClose: () => void; onSelect: () => void }) => (
  <ContextMenu x={30} y={40} onClose={onClose}>
    <MenuItem onSelect={onSelect}>Làm gì đó</MenuItem>
  </ContextMenu>
);

describe("ContextMenu", () => {
  it("renders a portal menu with its items", () => {
    render(<Harness onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Làm gì đó" })).toBeTruthy();
  });

  it("closes on Escape and on outside mousedown, not on inside mousedown", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} onSelect={vi.fn()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("item click runs close() before onSelect (MenuContext contract)", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(<Harness onClose={onClose} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Làm gì đó" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/ContextMenu.test.tsx`
Expected: FAIL — `ContextMenu` chưa tồn tại.

- [ ] **Step 3: Export MenuContext + item selector from Menu.tsx**

Trong `src/components/ui/Menu.tsx`, đổi 2 dòng:

```ts
const MenuContext = createContext<{ close: () => void }>({ close: () => {} });
const ITEMS = "[role^=menuitem]:not([disabled])";
```

thành:

```ts
export const MenuContext = createContext<{ close: () => void }>({ close: () => {} });
export const MENU_ITEMS = "[role^=menuitem]:not([disabled])";
```

và thay mọi tham chiếu `ITEMS` trong file bằng `MENU_ITEMS` (3 chỗ: `onKey` focus, `onListKey`).

- [ ] **Step 4: Write ContextMenu.tsx**

```tsx
// src/components/ui/ContextMenu.tsx
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MENU_ITEMS, MenuContext } from "./Menu";

interface ContextMenuProps {
  /** Viewport coordinates of the right-click. */
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Cursor-anchored menu: like Menu (Esc/click-outside/arrow keys, shared
 * MenuItem components) but rendered in a portal at fixed coordinates —
 * there is no trigger element to anchor to.
 */
export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // The menu size is only known after the first paint — clamp it into the viewport once.
  useLayoutEffect(() => {
    const r = listRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos((p) => ({
      x: Math.max(8, Math.min(p.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(p.y, window.innerHeight - r.height - 8)),
    }));
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!listRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(MENU_ITEMS)?.focus());
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>(MENU_ITEMS) ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return createPortal(
    <MenuContext.Provider value={{ close: onClose }}>
      <div
        ref={listRef}
        role="menu"
        onKeyDown={onListKey}
        style={{ left: pos.x, top: pos.y, width: 232 }}
        className="fixed z-50 max-h-[min(440px,calc(100vh-16px))] overflow-y-auto rounded-md border border-composer-border bg-popover p-1.5 shadow-popover"
      >
        {children}
      </div>
    </MenuContext.Provider>,
    document.body,
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/ui/ContextMenu.test.tsx && npx vitest run src/components/ui`
Expected: PASS (Context mới 3 tests + các test Menu hiện có vẫn xanh).

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/Menu.tsx src/components/ui/ContextMenu.tsx src/components/ui/ContextMenu.test.tsx
git commit -m "feat(ui): cursor-anchored ContextMenu portal sharing Menu items"
```

---

### Task 3: composerStore — snippet ảo + kênh pendingContext

**Files:**
- Modify: `src/lib/store/composerStore.ts`
- Test: `src/lib/store/composerStore.test.ts`

**Interfaces:**
- Consumes: `DraftAttachment`, `patch` nội bộ, `MAX_DOC_CHARS` từ `../chat/payload` (đã import).
- Produces:
  - `export type PendingChatContext = { kind: "snippet"; title: string; text: string } | { kind: "note"; noteId: string; title: string };`
  - State `pendingContext: PendingChatContext | null`
  - `pushChatContext(ctx: PendingChatContext): void`
  - `takeChatContext(): PendingChatContext | null` (trả về và clear)
  - `addSnippet(chatId: string, snippet: { originalName: string; text: string }): void`

- [ ] **Step 1: Write the failing tests**

Thêm vào `src/lib/store/composerStore.test.ts` — sửa `beforeEach` và thêm describe mới (giữ nguyên phần cũ):

```ts
// beforeEach — thêm pendingContext:
beforeEach(() => {
  invoke.mockReset();
  useComposerStore.setState({ drafts: {}, pendingContext: null });
});

describe("addSnippet (virtual document attachment)", () => {
  it("appends a ready document without touching the filesystem", () => {
    useComposerStore.getState().addSnippet("c1", { originalName: "Ghi chú A (đoạn chọn).md", text: "nội dung" });
    const a = useComposerStore.getState().drafts.c1!.attachments[0]!;
    expect(a).toMatchObject({
      name: "",
      originalName: "Ghi chú A (đoạn chọn).md",
      kind: "document",
      status: "ready",
      text: "nội dung",
    });
    expect(a.size).toBe("nội dung".length);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("replaces an identical snippet instead of duplicating", () => {
    const s = useComposerStore.getState();
    s.addSnippet("c1", { originalName: "a.md", text: "same" });
    s.addSnippet("c1", { originalName: "a.md", text: "same" });
    expect(useComposerStore.getState().drafts.c1!.attachments).toHaveLength(1);
  });

  it("clips text at 20k like real document extracts", () => {
    useComposerStore.getState().addSnippet("c1", { originalName: "a.md", text: "x".repeat(30_000) });
    expect(useComposerStore.getState().drafts.c1!.attachments[0]!.text).toHaveLength(20_000);
  });
});

describe("chat context bridge", () => {
  it("takeChatContext returns null when empty", () => {
    expect(useComposerStore.getState().takeChatContext()).toBeNull();
  });

  it("pushChatContext then takeChatContext returns and clears", () => {
    useComposerStore.getState().pushChatContext({ kind: "note", noteId: "n1", title: "Ghi chú A" });
    expect(useComposerStore.getState().pendingContext).toEqual({ kind: "note", noteId: "n1", title: "Ghi chú A" });
    expect(useComposerStore.getState().takeChatContext()).toEqual({ kind: "note", noteId: "n1", title: "Ghi chú A" });
    expect(useComposerStore.getState().pendingContext).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/store/composerStore.test.ts`
Expected: FAIL — TypeScript/`addSnippet is not a function`.

- [ ] **Step 3: Implement in composerStore.ts**

Thêm type + state + actions (creator đổi `(set)` → `(set, get)`):

```ts
export type PendingChatContext =
  | { kind: "snippet"; title: string; text: string }
  | { kind: "note"; noteId: string; title: string };
```

Interface thêm:

```ts
interface ComposerState {
  drafts: Record<string, ComposerDraft>;
  /** One-shot handoff NoteEditor → Composer (right-click "send to AI"). */
  pendingContext: PendingChatContext | null;
  setEditorState: (chatId: string, editorJson: string | null, text: string) => void;
  addAttachmentFiles: (chatId: string, files: File[]) => Promise<void>;
  addAttachmentPaths: (chatId: string, paths: string[]) => Promise<void>;
  removeAttachment: (chatId: string, id: string) => void;
  clearDraft: (chatId: string) => void;
  addSnippet: (chatId: string, snippet: { originalName: string; text: string }) => void;
  pushChatContext: (ctx: PendingChatContext) => void;
  takeChatContext: () => PendingChatContext | null;
}
```

Trong creator — đổi chữ ký và thêm 3 actions vào object trả về:

```ts
(set, get) => {
  // …patch/markError/hydrate/importPaths giữ nguyên…

  return {
    drafts: {},
    pendingContext: null,
    setEditorState: /* giữ nguyên */,

    addSnippet: (chatId, { originalName, text }) => {
      const clipped = text.slice(0, MAX_DOC_CHARS);
      patch(chatId, (d) => ({
        ...d,
        attachments: [
          ...d.attachments.filter(
            (a) => !(a.status === "ready" && a.originalName === originalName && a.text === clipped),
          ),
          {
            id: newId(),
            name: "",
            originalName,
            size: clipped.length,
            kind: "document" as const,
            status: "ready" as const,
            text: clipped,
          },
        ],
      }));
    },

    pushChatContext: (ctx) => set({ pendingContext: ctx }),
    takeChatContext: () => {
      const ctx = get().pendingContext;
      if (ctx) set({ pendingContext: null });
      return ctx;
    },

    addAttachmentFiles: /* giữ nguyên */,
    // …phần còn lại giữ nguyên…
  };
}
```

Lưu ý: `partialize` hiện chỉ persist `drafts` → `pendingContext` tự động không bị persist, không cần sửa.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/store/composerStore.test.ts`
Expected: PASS (toàn bộ, gồm các test cũ).

- [ ] **Step 5: Commit**

```bash
git add src/lib/store/composerStore.ts src/lib/store/composerStore.test.ts
git commit -m "feat(composer): virtual snippet attachment + NoteEditor→Composer context bridge"
```

---

### Task 4: Composer consume pendingContext

**Files:**
- Modify: `src/components/chat/composer/ContextTokenNode.tsx` (thêm helper `appendNoteToken`)
- Modify: `src/components/chat/composer/Composer.tsx` (effect consume)
- Test: `src/components/chat/composer/Composer.test.tsx`

**Interfaces:**
- Consumes: `pushChatContext`/`takeChatContext`/`addSnippet` từ Task 3; `$createContextTokenNode` có sẵn.
- Produces: `appendNoteToken(editor: LexicalEditor, note: { id: string; title: string }): void` — append token + space cuối paragraph cuối, đặt selection sau space.

- [ ] **Step 1: Write the failing tests**

Sửa `beforeEach` của `Composer.test.tsx` (thêm `pendingContext: null`) và thêm 2 test vào describe `Composer`:

```tsx
beforeEach(() => {
  invoke.mockReset();
  openDialog.mockReset();
  useNotesStore.setState({ notes: [], selectedId: null, tags: [] });
  useComposerStore.setState({ drafts: {}, pendingContext: null });
  useChatStore.setState({ status: "idle", error: null });
});

it("consumes a pending snippet into the attachment tray", async () => {
  render(<Composer placeholder="Hỏi…" />);
  useComposerStore
    .getState()
    .pushChatContext({ kind: "snippet", title: "Ghi chú A (đoạn chọn).md", text: "nội dung đoạn" });
  await waitFor(() =>
    expect(screen.getByRole("listitem", { name: "Ghi chú A (đoạn chọn).md" })).toBeTruthy(),
  );
  expect(useComposerStore.getState().pendingContext).toBeNull();
});

it("consumes a pending note mention as an @token chip", async () => {
  render(<Composer placeholder="Hỏi…" />);
  useComposerStore.getState().pushChatContext({ kind: "note", noteId: "n1", title: "Ghi chú B" });
  await waitFor(() => expect(screen.getByText("Ghi chú B")).toBeTruthy());
  expect(useComposerStore.getState().pendingContext).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/chat/composer/Composer.test.tsx`
Expected: FAIL — 2 test mới fail (không consume), test cũ vẫn xanh.

- [ ] **Step 3: Add `appendNoteToken` to ContextTokenNode.tsx**

Bổ sung import từ lexical: `$createParagraphNode`, `$getRoot`, `$isParagraphNode`. Thêm vào cuối file:

```ts
/**
 * Append a note token + space at the end of the composer text (used by the
 * right-click "ask AI about this note" flow, where there is no caret yet) and
 * place the selection after the space so typing continues naturally.
 */
export function appendNoteToken(editor: LexicalEditor, note: { id: string; title: string }): void {
  editor.update(
    () => {
      const root = $getRoot();
      let p = root.getLastChild();
      if (!$isParagraphNode(p)) {
        p = $createParagraphNode();
        root.append(p);
      }
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
```

- [ ] **Step 4: Wire the consume effect in Composer.tsx**

Thêm import:

```ts
import { useEffect } from "react"; // gộp vào dòng import react hiện có
import { appendNoteToken } from "./ContextTokenNode"; // gộp vào import hiện có của ContextTokenNode
```

Trong component, thêm selectors + effect (đặt sau các selector hiện có):

```tsx
const pendingContext = useComposerStore((s) => s.pendingContext);
const takeChatContext = useComposerStore((s) => s.takeChatContext);
const addSnippet = useComposerStore((s) => s.addSnippet);

// One-shot handoff from the note editor's right-click menu: a snippet becomes
// a virtual attachment, a note becomes an @token; then focus the composer.
useEffect(() => {
  if (!pendingContext) return;
  const ctx = takeChatContext();
  if (!ctx) return;
  if (ctx.kind === "snippet") {
    addSnippet(chatId, { originalName: ctx.title, text: ctx.text });
  } else if (editorRef.current) {
    appendNoteToken(editorRef.current, { id: ctx.noteId, title: ctx.title });
  }
  editorRef.current?.focus();
}, [pendingContext, chatId, takeChatContext, addSnippet]);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/chat/composer/Composer.test.tsx`
Expected: PASS (toàn bộ).

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/composer/ContextTokenNode.tsx src/components/chat/composer/Composer.tsx src/components/chat/composer/Composer.test.tsx
git commit -m "feat(composer): consume pending chat context (snippet chip / @note token)"
```

---

### Task 5: EditorContextMenu + wiring vào NoteEditor

**Files:**
- Create: `src/components/notes/EditorContextMenu.tsx`
- Modify: `src/components/notes/NoteEditor.tsx`
- Test: `src/components/notes/EditorContextMenu.test.tsx`

**Interfaces:**
- Consumes: `ContextMenu` (Task 2), `getSelectionInfo` (Task 1), `pushChatContext` (Task 3), `useUi.setChatOpen`.
- Produces: `EditorContextMenu({ x, y, hasSelection, onClose, onSelection, onWholeNote, onCopy })` — thuần UI, action do NoteEditor owning.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/notes/EditorContextMenu.test.tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditorContextMenu } from "./EditorContextMenu";

const base = {
  x: 10,
  y: 20,
  onClose: vi.fn(),
  onSelection: vi.fn(),
  onWholeNote: vi.fn(),
  onCopy: vi.fn(),
};

describe("EditorContextMenu", () => {
  it("with selection: offers send-to-AI and copy", () => {
    const onSelection = vi.fn();
    render(<EditorContextMenu {...base} onSelection={onSelection} hasSelection />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Gửi vào Trợ lý AI" }));
    expect(onSelection).toHaveBeenCalledTimes(1);
    expect(base.onClose).toHaveBeenCalledTimes(1); // MenuItem closes before onSelect
    expect(screen.getByRole("menuitem", { name: "Sao chép" })).toBeTruthy();
  });

  it("without selection: offers ask-AI-about-this-note only", () => {
    const onWholeNote = vi.fn();
    render(<EditorContextMenu {...base} onWholeNote={onWholeNote} hasSelection={false} />);
    expect(screen.queryByRole("menuitem", { name: "Gửi vào Trợ lý AI" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Hỏi AI về ghi chú này" }));
    expect(onWholeNote).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/notes/EditorContextMenu.test.tsx`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Write EditorContextMenu.tsx**

```tsx
// src/components/notes/EditorContextMenu.tsx
import { Copy, Sparkles } from "lucide-react";
import { ContextMenu } from "../ui/ContextMenu";
import { MenuItem } from "../ui/Menu";

interface EditorContextMenuProps {
  x: number;
  y: number;
  hasSelection: boolean;
  onClose: () => void;
  /** "Gửi vào Trợ lý AI" — attach the selection as a virtual snippet. */
  onSelection: () => void;
  /** "Hỏi AI về ghi chú này" — insert the whole note as an @token. */
  onWholeNote: () => void;
  /** Plain copy of the selection (replaces the blocked native menu). */
  onCopy: () => void;
}

/** Right-click menu inside the note editor: hands context to the assistant. */
export function EditorContextMenu({
  x, y, hasSelection, onClose, onSelection, onWholeNote, onCopy,
}: EditorContextMenuProps) {
  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {hasSelection ? (
        <>
          <MenuItem icon={<Sparkles size={14} />} onSelect={onSelection}>
            Gửi vào Trợ lý AI
          </MenuItem>
          <MenuItem icon={<Copy size={14} />} onSelect={onCopy}>
            Sao chép
          </MenuItem>
        </>
      ) : (
        <MenuItem icon={<Sparkles size={14} />} onSelect={onWholeNote}>
          Hỏi AI về ghi chú này
        </MenuItem>
      )}
    </ContextMenu>
  );
}
```

- [ ] **Step 4: Wire into NoteEditor.tsx**

Imports thêm:

```ts
import { useComposerStore } from "../../lib/store/composerStore";
import { getSelectionInfo } from "../../lib/editor/selection";
import { EditorContextMenu } from "./EditorContextMenu";
```

Trong `NoteEditor()`, thêm selectors + state (cạnh các selector hiện có):

```tsx
const setChatOpen = useUi((s) => s.setChatOpen);
const pushChatContext = useComposerStore((s) => s.pushChatContext);
const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null);
```

Thêm actions (đặt cạnh `exportPdf`):

```tsx
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
  pushChatContext({ kind: "snippet", title: `${note.title || "ghi chú"} (đoạn chọn).md`, text: info.text });
  setChatOpen(true);
};

const askAssistantAboutNote = () => {
  pushChatContext({ kind: "note", noteId: note.id, title: note.title || "Ghi chú" });
  setChatOpen(true);
};

const copySelection = () => {
  if (!view) return;
  const text = getSelectionInfo(view.state).text;
  void navigator.clipboard.writeText(text).then(() =>
    pushToast({ message: "Đã sao chép", durationMs: 3000 }),
  );
};
```

Đổi div editor thành có handler (đây cũng là chỗ render menu):

```tsx
<div ref={editorHost} onContextMenu={openContextMenu} />
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
```

- [ ] **Step 5: Run test to verify it passes + full suite**

Run: `npx vitest run src/components/notes/EditorContextMenu.test.tsx && npm test`
Expected: PASS toàn bộ (không test cũ nào vỡ).

- [ ] **Step 6: Commit**

```bash
git add src/components/notes/EditorContextMenu.tsx src/components/notes/EditorContextMenu.test.tsx src/components/notes/NoteEditor.tsx
git commit -m "feat(notes): right-click menu sends selection/note to the assistant"
```

---

### Task 6: Verification tổng

- [ ] **Step 1: Full test suite + type-check build**

Run: `npm test && npm run build`
Expected: toàn bộ test xanh (≥174 TS tests); `tsc --noEmit` không lỗi; vite build thành công.

- [ ] **Step 2: Kiểm tra bằng tay (nếu chạy được `npm run tauri dev`)**

1. Mở 1 note, bôi đen đoạn → chuột phải → menu hiện tại con trỏ: "Gửi vào Trợ lý AI" + "Sao chép".
2. Chọn "Gửi vào Trợ lý AI" → panel Trợ lý mở, chip "«tên note» (đoạn chọn).md" trong khay, focus ô nhập; gõ "review giúp đoạn này" → Enter → AI nhận đúng đoạn trong context `[File: …]`.
3. Bỏ selection, chuột phải → "Hỏi AI về ghi chú này" → chat mở, token @«tên note» trong composer.
4. Chuột phải → "Sao chép" → clipboard chứa đoạn chọn.
5. Chat đang streaming vẫn nhận chip mới; nút Gửi disabled đến khi xong.

- [ ] **Step 3: Cập nhật docs (composer notes) nếu cần**

Không bắt buộc — nếu có file docs ghi chú tính năng composer, thêm 1 dòng về flow chuột phải. Commit cuối (nếu có): `docs: editor right-click → assistant flow`.
