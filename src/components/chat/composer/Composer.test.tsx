import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const openDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...a: unknown[]) => openDialog(...a) }));

import { Composer } from "./Composer";
import { useChatStore } from "../../../lib/store/chatStore";
import { useComposerStore } from "../../../lib/store/composerStore";
import { useNotesStore } from "../../../lib/store/notesStore";

const fakeFile = (bytes: number[], name: string, type = "image/png"): File =>
  ({ name, size: bytes.length, type, arrayBuffer: async () => new Uint8Array(bytes).buffer }) as unknown as File;

beforeEach(() => {
  invoke.mockReset();
  openDialog.mockReset();
  useNotesStore.setState({ notes: [], selectedId: null, tags: [] });
  useComposerStore.setState({ drafts: {}, pendingContext: null });
  useChatStore.setState({ status: "idle", error: null });
});

describe("Composer", () => {
  it("send disabled with an empty draft, enabled once a ready attachment exists", async () => {
    invoke
      .mockImplementationOnce(() => Promise.resolve({ name: "uuid-a.png", size: 3, path: "C:/a.png" }))
      .mockImplementationOnce(() => Promise.resolve("data:image/png;base64,AA"));
    render(<Composer placeholder="Hỏi…" />);
    expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeDisabled();

    openDialog.mockResolvedValue(["C:/pic.png"]);
    fireEvent.click(screen.getByRole("button", { name: "Đính kèm file" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeEnabled(),
    );
    expect(screen.getByRole("listitem", { name: "pic.png" })).toBeTruthy();
    expect(screen.getByAltText("")).toHaveAttribute("src", "data:image/png;base64,AA");
  });

  it("sends the payload with attachment and clears the draft on ok", async () => {
    invoke
      .mockImplementationOnce(() => Promise.resolve({ name: "uuid-a.png", size: 3, path: "C:/a.png" }))
      .mockImplementationOnce(() => Promise.resolve("data:image/png;base64,AA"));
    const spy = vi.fn().mockResolvedValue({ ok: true });
    useChatStore.setState({ send: spy as never });
    render(<Composer placeholder="Hỏi…" />);
    const chatId = useChatStore.getState().chatId;
    await useComposerStore.getState().addAttachmentFiles(chatId, [fakeFile([1, 2, 3], "a.png")]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Gửi (Enter)" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const payload = spy.mock.calls[0]![0] as { text: string; mentions: unknown[]; attachments: { name: string }[] };
    expect(payload.attachments[0]!.name).toBe("uuid-a.png");
    expect(useComposerStore.getState().drafts[chatId]).toBeUndefined();
  });

  it("keeps the draft when send is rejected", async () => {
    invoke
      .mockImplementationOnce(() => Promise.resolve({ name: "u.png", size: 1, path: "C:/u.png" }))
      .mockImplementationOnce(() => Promise.resolve("data:image/png;base64,AA"));
    const spy = vi.fn().mockResolvedValue({ ok: false, error: "Chưa cấu hình provider AI" });
    useChatStore.setState({ send: spy as never, error: "Chưa cấu hình provider AI" });
    render(<Composer placeholder="Hỏi…" />);
    const chatId = useChatStore.getState().chatId;
    await useComposerStore.getState().addAttachmentFiles(chatId, [fakeFile([1], "u.png")]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Gửi (Enter)" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(useComposerStore.getState().drafts[chatId]).toBeDefined();
  });

  it("preserves draft changes made while an accepted send is pending", async () => {
    let resolveSend!: (value: { ok: true }) => void;
    let resolveImport!: (value: { name: string; size: number; path: string }) => void;
    const spy = vi.fn(() => new Promise<{ ok: true }>((resolve) => { resolveSend = resolve; }));
    useChatStore.setState({ send: spy as never });
    const chatId = useChatStore.getState().chatId;
    useComposerStore.setState({
      drafts: {
        [chatId]: {
          editorJson: null,
          text: "",
          attachments: [{
            id: "sent-attachment",
            name: "sent.txt",
            originalName: "sent.txt",
            size: 4,
            kind: "document",
            status: "ready",
            text: "sent",
          }],
        },
      },
    });
    render(<Composer placeholder="Hỏi…" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Gửi (Enter)" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    useComposerStore.getState().setEditorState(chatId, "new-json", "bản nháp mới");
    invoke.mockReset();
    invoke.mockImplementationOnce(() => new Promise((resolve) => { resolveImport = resolve; }));
    const added = useComposerStore.getState().addSnippet(chatId, { originalName: "new.md", text: "new context" });
    await waitFor(() => expect(
      useComposerStore.getState().drafts[chatId]?.attachments.find((a) => a.originalName === "new.md")?.status,
    ).toBe("importing"));
    resolveSend({ ok: true });
    await waitFor(() => expect(useComposerStore.getState().drafts[chatId]?.text).toBe("bản nháp mới"));
    expect(useComposerStore.getState().drafts[chatId]!.attachments[0]).toMatchObject({
      originalName: "new.md",
      status: "importing",
    });

    resolveImport({ name: "uuid-new.md", size: 11, path: "C:/att/uuid-new.md" });
    await added;
    expect(useComposerStore.getState().drafts[chatId]!.attachments[0]).toMatchObject({
      name: "uuid-new.md",
      status: "ready",
    });
  });

  it("cancels a stale send snapshot when context changes during note resolution", async () => {
    let resolveRead!: (value: unknown) => void;
    const spy = vi.fn().mockResolvedValue({ ok: true });
    useChatStore.setState({ send: spy as never });
    invoke.mockImplementation((command: string) => {
      if (command === "read_note") return new Promise((resolve) => { resolveRead = resolve; });
      if (command === "import_attachment_bytes") {
        return Promise.resolve({ name: "uuid-new.md", size: 11, path: "C:/att/uuid-new.md" });
      }
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });
    render(<Composer placeholder="Hỏi…" />);
    const chatId = useChatStore.getState().chatId;
    useComposerStore.getState().pushChatContext({ kind: "note", noteId: "n1", title: "Ghi chú B" });
    await waitFor(() => expect(screen.getByText("Ghi chú B")).toBeTruthy());
    await waitFor(() => expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Gửi (Enter)" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("read_note", { id: "n1" }));
    expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeDisabled();

    await useComposerStore.getState().addSnippet(chatId, { originalName: "new.md", text: "new context" });
    resolveRead({
      id: "n1",
      title: "Ghi chú B",
      body: "body",
      tags: [],
      pinned: false,
      created: "",
      updated: "",
      snippet: "",
      wordCount: 1,
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeEnabled());

    expect(spy).not.toHaveBeenCalled();
    expect(useComposerStore.getState().drafts[chatId]!.attachments).toContainEqual(
      expect.objectContaining({ originalName: "new.md", name: "uuid-new.md", status: "ready" }),
    );
  });

  it("does not send prepared context into a different chat after navigation", async () => {
    let resolveRead!: (value: unknown) => void;
    const spy = vi.fn().mockResolvedValue({ ok: true });
    useChatStore.setState({ send: spy as never });
    invoke.mockImplementation((command: string) => {
      if (command === "read_note") return new Promise((resolve) => { resolveRead = resolve; });
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });
    render(<Composer placeholder="Hỏi…" />);
    useComposerStore.getState().pushChatContext({ kind: "note", noteId: "n1", title: "Ghi chú B" });
    await waitFor(() => expect(screen.getByText("Ghi chú B")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Gửi (Enter)" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("read_note", { id: "n1" }));

    await useChatStore.getState().newChat();
    resolveRead({
      id: "n1",
      title: "Ghi chú B",
      body: "body",
      tags: [],
      pinned: false,
      created: "",
      updated: "",
      snippet: "",
      wordCount: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(spy).not.toHaveBeenCalled();
  });

  it("removes an attachment from the tray", async () => {
    invoke
      .mockImplementationOnce(() => Promise.resolve({ name: "u.png", size: 1, path: "C:/u.png" }))
      .mockImplementationOnce(() => Promise.resolve("data:image/png;base64,AA"));
    render(<Composer placeholder="Hỏi…" />);
    const chatId = useChatStore.getState().chatId;
    await useComposerStore.getState().addAttachmentFiles(chatId, [fakeFile([1], "u.png")]);
    await waitFor(() => expect(screen.getByRole("listitem", { name: "u.png" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Bỏ u.png" }));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "u.png" })).toBeNull());
  });

  it("shows a stop button while streaming", () => {
    useChatStore.setState({ status: "streaming" });
    render(<Composer placeholder="Hỏi…" />);
    expect(screen.getByRole("button", { name: "Dừng tạo câu trả lời" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Gửi (Enter)" })).toBeNull();
  });

  it("restores persisted attachment context that hydrates after mount", async () => {
    invoke.mockResolvedValueOnce("restored body");
    render(<Composer placeholder="Hỏi…" />);
    const chatId = useChatStore.getState().chatId;

    useComposerStore.setState({
      drafts: {
        [chatId]: {
          editorJson: null,
          text: "",
          attachments: [{
            id: "d1",
            name: "uuid-d.md",
            originalName: "d.md",
            size: 4,
            kind: "document",
            status: "ready",
          }],
        },
      },
    });

    await waitFor(() => expect(useComposerStore.getState().drafts[chatId]!.attachments[0]).toMatchObject({
      status: "ready",
      text: "restored body",
    }));
    expect(invoke).toHaveBeenCalledWith("extract_attachment_text", { path: "uuid-d.md" });
    expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeEnabled();
  });

  it("consumes a pending snippet into a durable attachment", async () => {
    invoke.mockResolvedValueOnce({ name: "uuid-chat-snippet.md", size: 14, path: "C:/att/uuid-chat-snippet.md" });
    render(<Composer placeholder="Hỏi…" />);
    useComposerStore
      .getState()
      .pushChatContext({ kind: "snippet", title: "Ghi chú A (đoạn chọn).md", text: "nội dung đoạn" });
    await waitFor(() =>
      expect(useComposerStore.getState().drafts[useChatStore.getState().chatId]?.attachments[0]).toMatchObject({
        name: "uuid-chat-snippet.md",
        status: "ready",
      }),
    );
    expect(screen.getByRole("listitem", { name: "Ghi chú A (đoạn chọn).md" })).toBeTruthy();
    expect(useComposerStore.getState().pendingContext).toBeNull();
  });

  it("does not send while a snippet import is still pending", async () => {
    let resolveImport!: (value: { name: string; size: number; path: string }) => void;
    invoke.mockImplementationOnce(() => new Promise((resolve) => { resolveImport = resolve; }));
    const spy = vi.fn().mockResolvedValue({ ok: true });
    useChatStore.setState({ send: spy as never });
    render(<Composer placeholder="Hỏi…" />);

    useComposerStore.getState().pushChatContext({ kind: "snippet", title: "a.md", text: "context" });
    await waitFor(() => expect(screen.getByRole("listitem", { name: "a.md" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Gửi (Enter)" }));
    expect(spy).not.toHaveBeenCalled();

    resolveImport({ name: "uuid-chat-snippet.md", size: 7, path: "C:/att/uuid-chat-snippet.md" });
    await waitFor(() =>
      expect(useComposerStore.getState().drafts[useChatStore.getState().chatId]?.attachments[0]?.status).toBe("ready"),
    );
  });

  it("consumes a pending note mention as an @token chip", async () => {
    render(<Composer placeholder="Hỏi…" />);
    useComposerStore.getState().pushChatContext({ kind: "note", noteId: "n1", title: "Ghi chú B" });
    await waitFor(() => expect(screen.getByText("Ghi chú B")).toBeTruthy());
    expect(useComposerStore.getState().pendingContext).toBeNull();
  });
});
