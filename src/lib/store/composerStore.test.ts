import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { IMAGE_EXTENSIONS, stripForPersist, useComposerStore } from "./composerStore";

/** jsdom's File lacks arrayBuffer — build a minimal stand-in with the same shape. */
const fakeFile = (bytes: number[], name: string, type = "image/png"): File =>
  ({ name, size: bytes.length, type, arrayBuffer: async () => new Uint8Array(bytes).buffer }) as unknown as File;

beforeEach(() => {
  invoke.mockReset();
  useComposerStore.setState({ drafts: {}, pendingContext: null });
});

describe("composerStore attachments", () => {
  it("imports bytes → ready image with preview + kind image", async () => {
    invoke
      .mockImplementationOnce(() => Promise.resolve({ name: "uuid-ảnh.png", size: 3, path: "C:/att/uuid-ảnh.png" }))
      .mockImplementationOnce(() => Promise.resolve("data:image/png;base64,AAA"));
    await useComposerStore.getState().addAttachmentFiles("c1", [
      fakeFile([1, 2, 3], "ảnh.png"),
    ]);
    const a = useComposerStore.getState().drafts.c1.attachments[0]!;
    expect(a.status).toBe("ready");
    expect(a.kind).toBe("image");
    expect(a.name).toBe("uuid-ảnh.png");
    expect(a.previewUrl).toContain("data:image/png");
    expect(a.originalName).toBe("ảnh.png");
    expect(invoke).toHaveBeenNthCalledWith(1, "import_attachment_bytes", {
      fileName: "ảnh.png",
      bytes: [1, 2, 3],
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "prepare_attachment_image", { path: "C:/att/uuid-ảnh.png" });
  });

  it("documents get extracted text capped at 20k", async () => {
    invoke
      .mockImplementationOnce(() => Promise.resolve({ name: "u.pdf", size: 9, path: "C:/att/u.pdf" }))
      .mockImplementationOnce(() => Promise.resolve("x".repeat(30_000)));
    await useComposerStore.getState().addAttachmentFiles("c1", [fakeFile([0, 0, 0, 0, 0, 0, 0, 0, 0], "a.pdf", "application/pdf")]);
    const a = useComposerStore.getState().drafts.c1.attachments[0]!;
    expect(a.kind).toBe("document");
    expect(a.text).toHaveLength(20_000);
  });

  it("import failure → status error with backend message", async () => {
    invoke.mockRejectedValueOnce(new Error("attachment-error: Định dạng không hỗ trợ: exe"));
    await useComposerStore.getState().addAttachmentFiles("c1", [fakeFile([0], "x.exe", "application/octet-stream")]);
    const a = useComposerStore.getState().drafts.c1.attachments[0]!;
    expect(a.status).toBe("error");
    expect(a.error).toContain("không hỗ trợ");
  });

  it("prepare failure → status error but file stored", async () => {
    invoke
      .mockImplementationOnce(() => Promise.resolve({ name: "u.png", size: 2, path: "C:/u.png" }))
      .mockRejectedValueOnce(new Error("attachment-error: Không mở được ảnh"));
    await useComposerStore.getState().addAttachmentPaths("c1", ["C:/pic.png"]);
    const a = useComposerStore.getState().drafts.c1.attachments[0]!;
    expect(a.status).toBe("error");
    expect(a.name).toBe("u.png");
  });

  it("paths import via importFile and drafts are per-chat", async () => {
    invoke.mockResolvedValue({ name: "u.png", size: 1, path: "C:/att/u.png" });
    await useComposerStore.getState().addAttachmentPaths("c1", ["C:/Users/me/u.png"]);
    await useComposerStore.getState().addAttachmentPaths("c2", ["C:/Users/me/v.png"]);
    const d = useComposerStore.getState().drafts;
    expect(d.c1!.attachments).toHaveLength(1);
    expect(d.c2!.attachments).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("import_attachment", { srcPath: "C:/Users/me/u.png" });
  });

  it("removeAttachment and clearDraft", async () => {
    invoke.mockResolvedValue({ name: "u.png", size: 1, path: "p" });
    await useComposerStore.getState().addAttachmentPaths("c1", ["C:/u.png"]);
    useComposerStore.getState().removeAttachment("c1", useComposerStore.getState().drafts.c1!.attachments[0]!.id);
    expect(useComposerStore.getState().drafts.c1!.attachments).toHaveLength(0);
    useComposerStore.getState().setEditorState("c1", "{}", "hi");
    useComposerStore.getState().clearDraft("c1");
    expect(useComposerStore.getState().drafts.c1).toBeUndefined();
  });

  it("setEditorState stores json and text", () => {
    useComposerStore.getState().setEditorState("c9", '{"root":{}}', "xin chào");
    expect(useComposerStore.getState().drafts.c9).toMatchObject({ editorJson: '{"root":{}}', text: "xin chào" });
  });
});

describe("stripForPersist", () => {
  it("drops previewUrl, importing items and empty drafts", () => {
    const out = stripForPersist({
      c1: {
        editorJson: "{}",
        text: "t",
        attachments: [
          { id: "a", name: "n", originalName: "n", size: 1, kind: "image", status: "ready", previewUrl: "data:…" },
          { id: "b", name: "m", originalName: "m", size: 1, kind: "image", status: "importing" },
        ],
      },
      c2: { editorJson: null, text: "", attachments: [] },
    });
    expect(Object.keys(out)).toEqual(["c1"]);
    const atts = out.c1!.attachments;
    expect(atts).toHaveLength(1);
    expect(atts[0]).not.toHaveProperty("previewUrl");
  });

  it("drops transient document text when a stored reference exists", () => {
    const out = stripForPersist({
      c1: {
        editorJson: null,
        text: "",
        attachments: [{
          id: "d1",
          name: "uuid-chat-snippet.md",
          originalName: "selection.md",
          size: 4,
          kind: "document",
          status: "ready",
          text: "private body",
        }],
      },
    });
    expect(out.c1!.attachments[0]).not.toHaveProperty("text");
    expect(out.c1!.attachments[0]!.name).toBe("uuid-chat-snippet.md");
  });
});

describe("addSnippet (durable document attachment)", () => {
  it("imports UTF-8 markdown bytes and stores a durable attachment name", async () => {
    invoke.mockResolvedValueOnce({ name: "uuid-chat-snippet.md", size: 12, path: "C:/att/uuid-chat-snippet.md" });

    await useComposerStore.getState().addSnippet("c1", {
      originalName: "Ghi chú A (đoạn chọn).md",
      text: "nội dung",
    });

    const a = useComposerStore.getState().drafts.c1!.attachments[0]!;
    expect(a).toMatchObject({
      name: "uuid-chat-snippet.md",
      originalName: "Ghi chú A (đoạn chọn).md",
      size: 12,
      kind: "document",
      status: "ready",
      text: "nội dung",
    });
    expect(invoke).toHaveBeenCalledWith("import_attachment_bytes", {
      fileName: "chat-snippet.md",
      bytes: Array.from(new TextEncoder().encode("nội dung")),
    });
  });

  it("does not import an identical durable snippet twice", async () => {
    invoke.mockResolvedValueOnce({ name: "uuid-chat-snippet.md", size: 4, path: "C:/att/uuid-chat-snippet.md" });
    const s = useComposerStore.getState();
    await s.addSnippet("c1", { originalName: "a.md", text: "same" });
    await s.addSnippet("c1", { originalName: "a.md", text: "same" });
    expect(useComposerStore.getState().drafts.c1!.attachments).toHaveLength(1);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("deduplicates identical snippets while the first import is in flight", async () => {
    let resolveImport!: (value: { name: string; size: number; path: string }) => void;
    invoke.mockImplementationOnce(() => new Promise((resolve) => { resolveImport = resolve; }));
    const s = useComposerStore.getState();

    const first = s.addSnippet("c1", { originalName: "a.md", text: "same" });
    const second = s.addSnippet("c1", { originalName: "a.md", text: "same" });
    expect(useComposerStore.getState().drafts.c1!.attachments).toHaveLength(1);
    expect(invoke).toHaveBeenCalledTimes(1);

    resolveImport({ name: "uuid-chat-snippet.md", size: 4, path: "C:/att/uuid-chat-snippet.md" });
    await Promise.all([first, second]);
  });

  it("does not recreate a removed or cleared draft after import completes", async () => {
    const resolvers: ((value: { name: string; size: number; path: string }) => void)[] = [];
    invoke.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
    const store = useComposerStore.getState();

    const removedImport = store.addSnippet("c1", { originalName: "remove.md", text: "remove" });
    const removedId = useComposerStore.getState().drafts.c1!.attachments[0]!.id;
    store.removeAttachment("c1", removedId);
    resolvers[0]!({ name: "uuid-remove.md", size: 6, path: "C:/att/uuid-remove.md" });
    await removedImport;
    expect(useComposerStore.getState().drafts.c1!.attachments).toEqual([]);

    const clearedImport = store.addSnippet("c2", { originalName: "clear.md", text: "clear" });
    store.clearDraft("c2");
    resolvers[1]!({ name: "uuid-clear.md", size: 5, path: "C:/att/uuid-clear.md" });
    await clearedImport;
    expect(useComposerStore.getState().drafts.c2).toBeUndefined();
  });

  it("clips persisted snippet text at 20k without splitting a surrogate pair", async () => {
    invoke.mockResolvedValueOnce({ name: "uuid-chat-snippet.md", size: 20_002, path: "C:/att/uuid-chat-snippet.md" });
    await useComposerStore.getState().addSnippet("c1", {
      originalName: "a.md",
      text: `${"x".repeat(19_999)}😀tail`,
    });
    const text = useComposerStore.getState().drafts.c1!.attachments[0]!.text!;
    expect([...text]).toHaveLength(20_000);
    expect(text.endsWith("😀")).toBe(true);
    expect(text).not.toContain("�");
    const [, args] = invoke.mock.calls[0]!;
    expect(new TextDecoder().decode(new Uint8Array((args as { bytes: number[] }).bytes))).toBe(text);
  });

  it("marks a snippet as error when its durable import fails", async () => {
    invoke.mockRejectedValueOnce(new Error("disk full"));
    await useComposerStore.getState().addSnippet("c1", { originalName: "a.md", text: "same" });
    expect(useComposerStore.getState().drafts.c1!.attachments[0]).toMatchObject({
      name: "",
      status: "error",
      error: "disk full",
    });
  });

  it("persists the durable snippet reference without its inline text requirement", async () => {
    invoke.mockResolvedValueOnce({ name: "uuid-chat-snippet.md", size: 4, path: "C:/att/uuid-chat-snippet.md" });
    await useComposerStore.getState().addSnippet("c1", { originalName: "a.md", text: "same" });
    const out = stripForPersist(useComposerStore.getState().drafts);
    expect(out.c1!.attachments[0]).toMatchObject({ name: "uuid-chat-snippet.md", status: "ready" });
    expect(out.c1!.attachments[0]).not.toHaveProperty("text");
  });

  it("materializes a legacy ready snippet that has text but no stored name", async () => {
    useComposerStore.setState({
      drafts: {
        c1: {
          editorJson: null,
          text: "",
          attachments: [{
            id: "legacy",
            name: "",
            originalName: "a.md",
            size: 4,
            kind: "document",
            status: "ready",
            text: "same",
          }],
        },
      },
    });
    invoke.mockResolvedValueOnce({ name: "uuid-chat-snippet.md", size: 4, path: "C:/att/uuid-chat-snippet.md" });

    await useComposerStore.getState().addSnippet("c1", { originalName: "a.md", text: "same" });

    expect(invoke).toHaveBeenCalledWith("import_attachment_bytes", {
      fileName: "chat-snippet.md",
      bytes: Array.from(new TextEncoder().encode("same")),
    });
    expect(useComposerStore.getState().drafts.c1!.attachments).toContainEqual(
      expect.objectContaining({ name: "uuid-chat-snippet.md", status: "ready", text: "same" }),
    );
  });
});

it("restores persisted attachment transient data from stored names", async () => {
  useComposerStore.setState({
    drafts: {
      c1: {
        editorJson: null,
        text: "",
        attachments: [
          { id: "i1", name: "u.png", originalName: "x.png", size: 3, kind: "image", status: "ready" },
          { id: "d1", name: "d.md", originalName: "d.md", size: 4, kind: "document", status: "ready" },
        ],
      },
    },
  });
  invoke
    .mockResolvedValueOnce("data:image/png;base64,RESTORED")
    .mockResolvedValueOnce("restored document");

  await useComposerStore.getState().restoreDraftAttachments("c1");

  const attachments = useComposerStore.getState().drafts.c1!.attachments;
  expect(attachments[0]).toMatchObject({ previewUrl: "data:image/png;base64,RESTORED", status: "ready" });
  expect(attachments[1]).toMatchObject({ text: "restored document", status: "ready" });
  expect(invoke).toHaveBeenNthCalledWith(1, "prepare_attachment_image", { path: "u.png" });
  expect(invoke).toHaveBeenNthCalledWith(2, "extract_attachment_text", { path: "d.md" });
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

describe("IMAGE_EXTENSIONS", () => {
  it("matches the backend allowlist", () => {
    expect(IMAGE_EXTENSIONS).toEqual(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
  });
});
