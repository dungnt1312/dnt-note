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

describe("IMAGE_EXTENSIONS", () => {
  it("matches the backend allowlist", () => {
    expect(IMAGE_EXTENSIONS).toEqual(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
  });
});
