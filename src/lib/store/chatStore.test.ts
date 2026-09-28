import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../agent/engine", () => ({
  runAgent: vi.fn(),
  buildSystemPrompt: vi.fn(() => "sys"),
}));
vi.mock("../api/chats", () => ({
  api: {
    chats: {
      list: vi.fn(async () => []),
      load: vi.fn(async () => ({ id: "c1", title: "t", messages: [], updated: "" })),
      save: vi.fn(async () => {}),
      del: vi.fn(async () => {}),
    },
  },
}));
vi.mock("../api/notes", () => ({
  api: {
    notes: {
      list: vi.fn(async () => []),
      stats: vi.fn(async () => ({ total: 0, pinned: 0, words: 0, tags: 0 })),
      del: vi.fn(async () => {}),
      read: vi.fn(async (id: string) => ({ id, title: `note-${id}`, body: `body-${id}` })),
    },
  },
}));
vi.mock("../api/attachments", () => ({
  attachmentsApi: {
    prepareImage: vi.fn(async (path: string) => `data:image/png;base64,${path}`),
    extractText: vi.fn(async (path: string) => `text-of-${path}`),
  },
}));

import { runAgent } from "../agent/engine";
import { api } from "../api/chats";
import { attachmentsApi } from "../api/attachments";
import { useChatStore, newId, type MentionInput } from "./chatStore";
import { useSettingsStore } from "./settingsStore";
import { api as notesApi } from "../api/notes";

const runAgentMock = vi.mocked(runAgent);
const saveMock = vi.mocked(api.chats.save);
const loadMock = vi.mocked(api.chats.load);
const deleteMock = vi.mocked(api.chats.del);
const readNoteMock = vi.mocked(notesApi.notes.read);

const send = (text: string, mentions: MentionInput[] = []) =>
  useChatStore.getState().send({ text, mentions, attachments: [] });

describe("chatStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveMock.mockReset().mockResolvedValue(undefined);
    loadMock.mockReset().mockResolvedValue({ id: "c1", title: "t", messages: [], updated: "" });
    deleteMock.mockReset().mockResolvedValue(undefined);
    runAgentMock.mockReset();
    readNoteMock.mockReset().mockImplementation(async (id: string) => ({ id, title: `note-${id}`, body: `body-${id}` }) as never);
    vi.mocked(attachmentsApi.prepareImage)
      .mockReset()
      .mockImplementation(async (path: string) => `data:image/png;base64,${path}`);
    vi.mocked(attachmentsApi.extractText)
      .mockReset()
      .mockImplementation(async (path: string) => `text-of-${path}`);
    useSettingsStore.setState({
      providers: [{ id: "p1", name: "Test", baseUrl: "http://x", model: "m", models: ["m"], apiKey: "k" }],
      activeProviderId: "p1",
      loaded: true,
    });
    useChatStore.setState({
      messages: [],
      chatId: newId(),
      chatTitle: "Phiên chat mới",
      status: "idle",
      error: null,
    });
  });

  it("send streams assistant content into messages", async () => {
    runAgentMock.mockImplementation(async ({ onEvent }) => {
      onEvent?.({ type: "delta", content: "Xin chào" });
      onEvent?.({ type: "delta", content: " bạn!" });
      onEvent?.({ type: "done", content: "Xin chào bạn!" });
      return { content: "Xin chào bạn!", messages: [], pendingDeletes: [] };
    });

    const res = await send("hi");
    expect(res).toEqual({ ok: true });
    const s = useChatStore.getState();
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0]).toMatchObject({ role: "user", content: "hi" });
    expect(s.messages[1]).toMatchObject({ role: "assistant", content: "Xin chào bạn!" });
    expect(s.status).toBe("idle");
    expect(saveMock).toHaveBeenCalled();
  });

  it("notifies the composer once the user turn is accepted, before the assistant finishes", async () => {
    let finishReply!: () => void;
    runAgentMock.mockImplementation(() => new Promise((resolve) => {
      finishReply = () => resolve({ content: "ok", messages: [], pendingDeletes: [] });
    }));
    const onAccepted = vi.fn();

    const pending = useChatStore.getState().send(
      { text: "xin chào", mentions: [], attachments: [] },
      undefined,
      onAccepted,
    );
    await vi.waitFor(() => expect(useChatStore.getState().messages[0]?.content).toBe("xin chào"));
    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().status).toBe("streaming");

    finishReply();
    await pending;
  });

  it("send rejects with {ok:false} and no mutation when the provider has no model", async () => {
    useSettingsStore.setState({
      providers: [{ id: "p1", name: "Test", baseUrl: "http://x", model: "", models: [], apiKey: "k" }],
    });
    const res = await send("hi");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/model/);
    expect(runAgentMock).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(useChatStore.getState().error).toMatch(/model/);
  });

  it("send rejects empty payloads", async () => {
    const res = await useChatStore.getState().send({ text: "   ", mentions: [], attachments: [] });
    expect(res.ok).toBe(false);
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it("keeps a prior image as an image_url part on follow-up", async () => {
    runAgentMock.mockResolvedValue({ content: "ok", messages: [], pendingDeletes: [] });
    await useChatStore.getState().send({
      text: "ảnh này là gì",
      mentions: [],
      attachments: [
        { id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image", previewUrl: "data:image/png;base64,AA" },
      ],
    });

    await send("giải thích chi tiết");

    const historyContent = runAgentMock.mock.calls[1]![0].messages[0]!.content;
    expect(Array.isArray(historyContent)).toBe(true);
    expect(historyContent).toContainEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AA" },
    });
  });

  it("keeps an image-only prior turn instead of sending empty history", async () => {
    runAgentMock.mockResolvedValue({ content: "ok", messages: [], pendingDeletes: [] });
    await useChatStore.getState().send({
      text: "",
      mentions: [],
      attachments: [
        { id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image", previewUrl: "data:image/png;base64,AA" },
      ],
    });

    await send("ảnh có gì?");

    const historyContent = runAgentMock.mock.calls[1]![0].messages[0]!.content;
    expect(Array.isArray(historyContent)).toBe(true);
    expect(historyContent).toContainEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AA" },
    });
  });

  it("reconstructs a loaded image from its stored attachment name", async () => {
    loadMock.mockResolvedValueOnce({
      id: "cL",
      title: "Phiên ảnh",
      updated: "",
      messages: [
        {
          role: "user",
          content: "ảnh này là gì",
          attachments: [{ id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image" as const }],
        },
        { role: "assistant", content: "một ảnh" },
      ],
    });
    runAgentMock.mockResolvedValue({ content: "ok", messages: [], pendingDeletes: [] });

    await useChatStore.getState().loadChat("cL");
    await send("giải thích thêm");

    expect(attachmentsApi.prepareImage).toHaveBeenCalledWith("u.png");
    const historyContent = runAgentMock.mock.calls[0]![0].messages[0]!.content;
    expect(historyContent).toContainEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,u.png" },
    });
  });

  it("re-reads prior note mentions and reuses in-memory document text on follow-up", async () => {
    runAgentMock.mockResolvedValue({ content: "ok", messages: [], pendingDeletes: [] });
    await useChatStore.getState().send({
      text: "đối chiếu",
      mentions: [{ id: "n1", title: "Roadmap", body: "nội dung cũ" }],
      attachments: [
        { id: "a1", name: "d.pdf", originalName: "d.pdf", size: 10, kind: "document", text: "file cũ" },
      ],
    });
    readNoteMock.mockResolvedValueOnce({ id: "n1", title: "Roadmap", body: "nội dung mới" } as never);

    await send("có thay đổi gì?");

    expect(readNoteMock).toHaveBeenCalledWith("n1");
    expect(attachmentsApi.extractText).not.toHaveBeenCalled();
    const historyContent = runAgentMock.mock.calls[1]![0].messages[0]!.content;
    expect(historyContent).toContain("nội dung mới");
    expect(historyContent).toContain("file cũ");
  });

  it("reconstructs a loaded document from its stored attachment name", async () => {
    loadMock.mockResolvedValueOnce({
      id: "cDoc",
      title: "Phiên tài liệu",
      updated: "",
      messages: [
        {
          role: "user",
          content: "đọc file",
          attachments: [{ id: "a1", name: "d.pdf", originalName: "d.pdf", size: 10, kind: "document" as const }],
        },
        { role: "assistant", content: "đã đọc" },
      ],
    });
    runAgentMock.mockResolvedValue({ content: "ok", messages: [], pendingDeletes: [] });

    await useChatStore.getState().loadChat("cDoc");
    await send("tóm tắt lại");

    expect(attachmentsApi.extractText).toHaveBeenCalledWith("d.pdf");
    const historyContent = runAgentMock.mock.calls[0]![0].messages[0]!.content;
    expect(historyContent).toContain("text-of-d.pdf");
  });

  it("reconstructs loaded documents and falls back when historical files are unavailable", async () => {
    loadMock.mockResolvedValueOnce({
      id: "cMissing",
      title: "Phiên thiếu file",
      updated: "",
      messages: [
        {
          role: "user",
          content: "phân tích",
          attachments: [
            { id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image" as const },
            { id: "a2", name: "d.pdf", originalName: "d.pdf", size: 10, kind: "document" as const },
          ],
        },
        { role: "assistant", content: "đã phân tích" },
      ],
    });
    vi.mocked(attachmentsApi.prepareImage).mockRejectedValueOnce(new Error("missing image"));
    vi.mocked(attachmentsApi.extractText).mockRejectedValueOnce(new Error("missing document"));
    runAgentMock.mockResolvedValue({ content: "ok", messages: [], pendingDeletes: [] });

    await useChatStore.getState().loadChat("cMissing");
    const result = await send("thử tiếp");

    expect(result).toEqual({ ok: true });
    expect(attachmentsApi.prepareImage).toHaveBeenCalledWith("u.png");
    expect(attachmentsApi.extractText).toHaveBeenCalledWith("d.pdf");
    const historyContent = runAgentMock.mock.calls[0]![0].messages[0]!.content;
    expect(historyContent).toContain("[Image unavailable: x.png]");
    expect(historyContent).toContain("[File unavailable: d.pdf]");
  });

  it("rejects a second send while historical attachments are still resolving", async () => {
    let resolveImage!: (value: string) => void;
    vi.mocked(attachmentsApi.prepareImage).mockImplementationOnce(
      () => new Promise<string>((resolve) => { resolveImage = resolve; }),
    );
    useChatStore.setState({
      messages: [{
        id: "old-user",
        role: "user",
        content: "ảnh cũ",
        attachments: [{ id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image" }],
      }],
    });
    runAgentMock.mockResolvedValue({ content: "ok", messages: [], pendingDeletes: [] });

    const first = send("lượt một");
    await vi.waitFor(() => expect(attachmentsApi.prepareImage).toHaveBeenCalled());
    const second = await send("lượt hai");
    resolveImage("data:image/png;base64,reloaded");
    await first;

    expect(second.ok).toBe(false);
    expect(runAgentMock).toHaveBeenCalledTimes(1);
  });

  it("stop cancels attachment reconstruction without waiting for the file read", async () => {
    let resolveImage!: (value: string) => void;
    vi.mocked(attachmentsApi.prepareImage).mockImplementationOnce(
      () => new Promise<string>((resolve) => { resolveImage = resolve; }),
    );
    useChatStore.setState({
      messages: [{
        id: "old-user",
        role: "user",
        content: "ảnh cũ",
        attachments: [{ id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image" }],
      }],
    });

    const pending = send("lượt mới");
    await vi.waitFor(() => expect(attachmentsApi.prepareImage).toHaveBeenCalled());
    useChatStore.getState().stop();
    const winner = await Promise.race([
      pending.then((result) => ({ kind: "result" as const, result })),
      new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), 30)),
    ]);
    resolveImage("data:image/png;base64,late");
    await pending;

    expect(winner.kind).toBe("result");
    if (winner.kind === "result") expect(winner.result.ok).toBe(false);
    expect(runAgentMock).not.toHaveBeenCalled();
    expect(useChatStore.getState().status).toBe("idle");
  });

  it("returns a rejected result when history reconstruction throws unexpectedly", async () => {
    const broken = {
      id: "broken-user",
      role: "user" as const,
      content: "cũ",
      get attachments(): never {
        throw new Error("broken history");
      },
    };
    useChatStore.setState({ messages: [broken] });

    const result = await send("lượt mới");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("broken history");
    expect(runAgentMock).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0]!.id).toBe("broken-user");
  });

  it("does not append a prepared send after switching to a new chat", async () => {
    let resolveImage!: (value: string) => void;
    vi.mocked(attachmentsApi.prepareImage).mockImplementationOnce(
      () => new Promise<string>((resolve) => { resolveImage = resolve; }),
    );
    useChatStore.setState({
      chatId: "old-chat",
      messages: [{
        id: "old-user",
        role: "user",
        content: "ảnh cũ",
        attachments: [{ id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image" }],
      }],
    });

    const pending = send("lượt cũ");
    await vi.waitFor(() => expect(attachmentsApi.prepareImage).toHaveBeenCalled());
    const navigation = useChatStore.getState().newChat();
    resolveImage("data:image/png;base64,reloaded");
    const [result] = await Promise.all([pending, navigation]);

    expect(result.ok).toBe(false);
    expect(runAgentMock).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("persists an accepted source turn before switching to a new chat", async () => {
    const sourceChatId = useChatStore.getState().chatId;
    runAgentMock.mockImplementationOnce(({ signal }) => new Promise((_, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));

    const pending = send("lượt phải lưu");
    await vi.waitFor(() => expect(runAgentMock).toHaveBeenCalled());
    const navigation = useChatStore.getState().newChat();
    await Promise.all([pending, navigation]);

    const savedSource = saveMock.mock.calls.map(([session]) => session).find((session) => session.id === sourceChatId);
    expect(savedSource?.messages[0]).toMatchObject({ role: "user", content: "lượt phải lưu" });
    expect(useChatStore.getState().chatId).not.toBe(sourceChatId);
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("remains busy until the accepted turn has finished persisting", async () => {
    let resolveSave!: () => void;
    saveMock.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    runAgentMock.mockResolvedValueOnce({ content: "ok", messages: [], pendingDeletes: [] });

    const first = send("lượt một");
    await vi.waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(useChatStore.getState().status).toBe("streaming");
    const second = await send("lượt hai");
    expect(second.ok).toBe(false);

    resolveSave();
    await first;
    expect(useChatStore.getState().status).toBe("idle");
  });

  it("ignores stale chat loads and rejects sends while navigation is pending", async () => {
    const resolvers = new Map<string, (session: Awaited<ReturnType<typeof api.chats.load>>) => void>();
    loadMock.mockImplementation((id) => new Promise((resolve) => { resolvers.set(id, resolve); }));

    const first = useChatStore.getState().loadChat("chat-a");
    await vi.waitFor(() => expect(resolvers.has("chat-a")).toBe(true));
    const blocked = await send("không được gửi");
    expect(blocked.ok).toBe(false);

    const second = useChatStore.getState().loadChat("chat-b");
    await vi.waitFor(() => expect(resolvers.has("chat-b")).toBe(true));
    resolvers.get("chat-b")!({ id: "chat-b", title: "B", updated: "", messages: [{ role: "assistant", content: "B" }] });
    await second;
    resolvers.get("chat-a")!({ id: "chat-a", title: "A", updated: "", messages: [{ role: "assistant", content: "A" }] });
    await first;

    expect(useChatStore.getState()).toMatchObject({ chatId: "chat-b", chatTitle: "B", status: "idle" });
    expect(useChatStore.getState().messages[0]!.content).toBe("B");
  });

  it("keeps an accepted turn dirty after save failure and retries before navigation", async () => {
    const sourceChatId = useChatStore.getState().chatId;
    saveMock.mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce(undefined);
    runAgentMock.mockResolvedValueOnce({ content: "ok", messages: [], pendingDeletes: [] });

    const result = await send("phải lưu");
    expect(result).toEqual({ ok: true });
    expect(useChatStore.getState().error).toContain("disk full");

    await useChatStore.getState().newChat();

    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock.mock.calls[1]![0]).toMatchObject({ id: sourceChatId });
    expect(saveMock.mock.calls[1]![0].messages[0]).toMatchObject({ content: "phải lưu" });
    expect(useChatStore.getState().sessions.some((session) => session.id === sourceChatId)).toBe(true);
    expect(useChatStore.getState().chatId).not.toBe(sourceChatId);
  });

  it("does not send a pending payload into a new chat while dirty state is flushing", async () => {
    saveMock.mockRejectedValueOnce(new Error("disk full"));
    runAgentMock.mockResolvedValueOnce({ content: "ok", messages: [], pendingDeletes: [] });
    await send("dirty turn");

    let resolveFlush!: () => void;
    saveMock.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFlush = resolve; }));
    runAgentMock.mockClear();
    const pendingSend = send("must not move chats");
    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2));
    const navigation = useChatStore.getState().newChat();
    resolveFlush();
    const [result] = await Promise.all([pendingSend, navigation]);

    expect(result.ok).toBe(false);
    expect(runAgentMock).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("serializes queued chat mutations in FIFO order", async () => {
    const chatId = useChatStore.getState().chatId;
    let resolveRun!: (value: { content: string; messages: []; pendingDeletes: [] }) => void;
    let resolveRenameSave!: () => void;
    runAgentMock.mockImplementationOnce(() => new Promise((resolve) => { resolveRun = resolve; }));
    saveMock
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveRenameSave = resolve; }));

    const pendingSend = send("tin mới");
    await vi.waitFor(() => expect(runAgentMock).toHaveBeenCalled());
    const pendingRename = useChatStore.getState().renameChat(chatId, "Tên mới");
    const pendingDelete = useChatStore.getState().deleteChat("other-chat");
    resolveRun({ content: "ok", messages: [], pendingDeletes: [] });
    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2));
    expect(deleteMock).not.toHaveBeenCalled();

    resolveRenameSave();
    await Promise.all([pendingSend, pendingRename, pendingDelete]);
    expect(deleteMock).toHaveBeenCalledWith("other-chat");
  });

  it("keeps the retry lease through resend before a queued rename", async () => {
    const chatId = useChatStore.getState().chatId;
    let resolveImage!: (value: string) => void;
    vi.mocked(attachmentsApi.prepareImage).mockImplementationOnce(
      () => new Promise<string>((resolve) => { resolveImage = resolve; }),
    );
    useChatStore.setState({
      messages: [
        {
          id: "u1",
          role: "user",
          content: "hỏi lại",
          attachments: [{ id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image" }],
        },
        { id: "a1", role: "assistant", content: "cũ" },
      ],
    });
    runAgentMock.mockResolvedValue({ content: "mới", messages: [], pendingDeletes: [] });

    const retry = useChatStore.getState().retryLast();
    await vi.waitFor(() => expect(attachmentsApi.prepareImage).toHaveBeenCalled());
    const rename = useChatStore.getState().renameChat(chatId, "Tên mới");
    resolveImage("data:image/png;base64,reloaded");
    await Promise.all([retry, rename]);

    expect(runAgentMock).toHaveBeenCalledTimes(1);
    const lastSaved = saveMock.mock.calls.at(-1)![0];
    expect(lastSaved).toMatchObject({ id: chatId, title: "Tên mới" });
    expect(lastSaved.messages[0]).toMatchObject({ role: "user", content: "hỏi lại" });
  });

  it("serializes rename after an active send without losing new messages", async () => {
    const chatId = useChatStore.getState().chatId;
    let resolveRun!: (value: { content: string; messages: []; pendingDeletes: [] }) => void;
    runAgentMock.mockImplementationOnce(() => new Promise((resolve) => { resolveRun = resolve; }));
    loadMock.mockResolvedValueOnce({ id: chatId, title: "Cũ", updated: "", messages: [] });

    const pendingSend = send("tin mới");
    await vi.waitFor(() => expect(runAgentMock).toHaveBeenCalled());
    const pendingRename = useChatStore.getState().renameChat(chatId, "Tên mới");
    expect(saveMock).not.toHaveBeenCalled();
    resolveRun({ content: "ok", messages: [], pendingDeletes: [] });
    await Promise.all([pendingSend, pendingRename]);

    const lastSaved = saveMock.mock.calls.at(-1)![0];
    expect(lastSaved).toMatchObject({ id: chatId, title: "Tên mới" });
    expect(lastSaved.messages[0]).toMatchObject({ role: "user", content: "tin mới" });
  });

  it("resets a chat that becomes current before its queued deletion executes", async () => {
    let resolveLoad!: (session: Awaited<ReturnType<typeof api.chats.load>>) => void;
    loadMock.mockImplementationOnce(() => new Promise((resolve) => { resolveLoad = resolve; }));

    const loading = useChatStore.getState().loadChat("target-chat");
    await vi.waitFor(() => expect(loadMock).toHaveBeenCalledWith("target-chat"));
    const deleting = useChatStore.getState().deleteChat("target-chat");
    resolveLoad({ id: "target-chat", title: "Target", updated: "", messages: [{ role: "assistant", content: "loaded" }] });
    await Promise.all([loading, deleting]);

    expect(deleteMock).toHaveBeenCalledWith("target-chat");
    expect(useChatStore.getState().chatId).not.toBe("target-chat");
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("does not cancel a confirmed delete when a newer navigation starts", async () => {
    const currentId = useChatStore.getState().chatId;
    let resolveRun!: (value: { content: string; messages: []; pendingDeletes: [] }) => void;
    runAgentMock.mockImplementationOnce(() => new Promise((resolve) => { resolveRun = resolve; }));
    loadMock.mockResolvedValueOnce({ id: "other-chat", title: "Other", updated: "", messages: [] });

    const pendingSend = send("đang chạy");
    await vi.waitFor(() => expect(runAgentMock).toHaveBeenCalled());
    const deleting = useChatStore.getState().deleteChat(currentId);
    const navigation = useChatStore.getState().loadChat("other-chat");
    resolveRun({ content: "ok", messages: [], pendingDeletes: [] });
    await Promise.all([pendingSend, deleting, navigation]);

    expect(deleteMock).toHaveBeenCalledWith(currentId);
    expect(useChatStore.getState().chatId).toBe("other-chat");
  });

  it("waits for an active send before deleting the current chat", async () => {
    const chatId = useChatStore.getState().chatId;
    runAgentMock.mockImplementationOnce(({ signal }) => new Promise((_, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));

    const pendingSend = send("tin sẽ xóa");
    await vi.waitFor(() => expect(runAgentMock).toHaveBeenCalled());
    const pendingDelete = useChatStore.getState().deleteChat(chatId);
    await Promise.all([pendingSend, pendingDelete]);

    const deleteOrder = deleteMock.mock.invocationCallOrder[0]!;
    const saveOrder = saveMock.mock.invocationCallOrder.at(-1)!;
    expect(deleteOrder).toBeGreaterThan(saveOrder);
    expect(useChatStore.getState().sessions.some((session) => session.id === chatId)).toBe(false);
  });

  it("tool events appear as toolCalls on the assistant message", async () => {
    runAgentMock.mockImplementation(async ({ onEvent }) => {
      onEvent?.({ type: "tool_start", id: "c1", name: "read_note", args: '{"id":"n1"}' });
      onEvent?.({ type: "tool_result", id: "c1", name: "read_note", result: '{"body":"x"}' });
      onEvent?.({ type: "done", content: "xong" });
      return { content: "xong", messages: [], pendingDeletes: [] };
    });

    await send("đọc n1");
    const m = useChatStore.getState().messages[1];
    expect(m.toolCalls).toHaveLength(1);
    expect(m.toolCalls?.[0]).toMatchObject({ name: "read_note", status: "done", result: '{"body":"x"}' });
  });

  it("pending_delete event creates a confirmable card; confirmDelete removes note", async () => {
    runAgentMock.mockImplementation(async ({ onEvent }) => {
      onEvent?.({ type: "pending_delete", id: "n9", title: "Ghi chú cần xóa" });
      onEvent?.({ type: "done", content: "đã yêu cầu xóa" });
      return { content: "đã yêu cầu xóa", messages: [], pendingDeletes: [{ id: "n9", title: "Ghi chú cần xóa" }] };
    });

    await send("xóa n9");
    const m = useChatStore.getState().messages[1];
    expect(m.pendingDeletes).toEqual([{ id: "n9", title: "Ghi chú cần xóa", status: "pending" }]);

    await useChatStore.getState().confirmDelete("n9");
    expect(useChatStore.getState().messages[1].pendingDeletes?.[0]?.status).toBe("confirmed");
  });

  it("keeps separate confirmations for every delete request and persists them across reload", async () => {
    runAgentMock.mockImplementation(async ({ onEvent }) => {
      for (const [id, title] of [["n1", "Một"], ["n2", "Hai"], ["n3", "Ba"]]) {
        onEvent?.({ type: "pending_delete", id, title });
      }
      return { content: "xác nhận từng ghi chú", messages: [], pendingDeletes: [] };
    });

    await send("xóa ba ghi chú");
    expect(useChatStore.getState().messages[1].pendingDeletes).toEqual([
      { id: "n1", title: "Một", status: "pending" },
      { id: "n2", title: "Hai", status: "pending" },
      { id: "n3", title: "Ba", status: "pending" },
    ]);
    useChatStore.getState().cancelDelete("n2");
    expect(useChatStore.getState().messages[1].pendingDeletes?.map((item) => item.status)).toEqual([
      "pending", "cancelled", "pending",
    ]);

    const saved = saveMock.mock.calls.at(-1)![0];
    loadMock.mockResolvedValueOnce(saved);
    await useChatStore.getState().newChat();
    await useChatStore.getState().loadChat(saved.id);
    expect(useChatStore.getState().messages[1].pendingDeletes?.map((item) => item.id)).toEqual(["n1", "n2", "n3"]);
  });

  it("persists each confirmation decision without changing the other requests", async () => {
    runAgentMock.mockImplementation(async ({ onEvent }) => {
      onEvent?.({ type: "pending_delete", id: "n1", title: "Một" });
      onEvent?.({ type: "pending_delete", id: "n2", title: "Hai" });
      return { content: "", messages: [], pendingDeletes: [] };
    });
    await send("xóa hai ghi chú");
    useChatStore.getState().cancelDelete("n1");
    await useChatStore.getState().confirmDelete("n2");
    await vi.waitFor(() => expect(saveMock.mock.calls.at(-1)?.[0].messages[1].pendingDeletes).toEqual([
      { id: "n1", title: "Một", status: "cancelled" },
      { id: "n2", title: "Hai", status: "confirmed" },
    ]));
  });

  it("error event sets error on message and status back to idle", async () => {
    runAgentMock.mockImplementation(async ({ onEvent }) => {
      onEvent?.({ type: "error", message: "LLM 401: bad key" });
      return { content: "", messages: [], pendingDeletes: [] };
    });

    await send("hi");
    const s = useChatStore.getState();
    expect(s.messages[1].error).toContain("401");
    expect(s.status).toBe("idle");
  });

  it("mentions are appended as note context", async () => {
    runAgentMock.mockImplementation(async ({ messages }) => {
      expect(messages.at(-1)?.content).toContain("[@Tài liệu]");
      return { content: "ok", messages: [], pendingDeletes: [] };
    });
    await send("tóm tắt", [{ id: "n1", title: "Tài liệu", body: "nội dung tài liệu" }]);
    const user = useChatStore.getState().messages[0];
    expect(user.content).toBe("tóm tắt");
    expect(user.mentions).toEqual([{ id: "n1", title: "Tài liệu" }]);
  });

  it("first exchange names the session and adds it to the session list", async () => {
    useChatStore.setState({ sessions: [] });
    runAgentMock.mockImplementation(async () => ({ content: "ok", messages: [], pendingDeletes: [] }));
    await send("Lên kế hoạch   tuần này");
    const s = useChatStore.getState();
    expect(s.chatTitle).toBe("Lên kế hoạch tuần này");
    expect(s.sessions[0]).toMatchObject({ id: s.chatId, title: "Lên kế hoạch tuần này" });
  });

  it("persist saves structured metadata; load restores chips", async () => {
    runAgentMock.mockImplementation(async () => ({ content: "ok", messages: [], pendingDeletes: [] }));
    await useChatStore.getState().send({
      text: "phân tích",
      mentions: [{ id: "n1", title: "Roadmap", body: "b" }],
      attachments: [
        { id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image", previewUrl: "data:…" },
        { id: "a2", name: "d.pdf", originalName: "d.pdf", size: 4, kind: "document", text: "secret document body" },
      ],
    });
    const saved = saveMock.mock.calls.at(-1)![0] as { messages: { mentions?: unknown[]; attachments?: unknown[] }[] };
    expect(saved.messages[0]!.mentions).toEqual([{ id: "n1", title: "Roadmap" }]);
    expect(saved.messages[0]!.attachments).toEqual([
      { id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image" },
      { id: "a2", name: "d.pdf", originalName: "d.pdf", size: 4, kind: "document" },
    ]);
    expect(JSON.stringify(saved)).not.toContain("data:…");
    expect(JSON.stringify(saved)).not.toContain("secret document body");

    loadMock.mockResolvedValueOnce({
      id: "cL",
      title: "Phiên load",
      updated: "",
      messages: [
        { role: "user", content: "phân tích", mentions: [{ id: "n1", title: "Roadmap" }], attachments: [{ id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image" as const }] },
        { role: "assistant", content: "", error: "LLM 500" },
      ],
    });
    await useChatStore.getState().loadChat("cL");
    const loaded = useChatStore.getState().messages;
    expect(loaded[0]!.mentions).toEqual([{ id: "n1", title: "Roadmap" }]);
    expect(loaded[0]!.attachments![0]).toMatchObject({ name: "u.png" });
    expect(loaded[1]!.error).toBe("LLM 500");
    expect(loaded[1]!.content).not.toContain("⚠");
  });

  it("retry re-reads mention bodies and attachment files from the message", async () => {
    runAgentMock.mockImplementation(async () => ({ content: "ok", messages: [], pendingDeletes: [] }));
    await useChatStore.getState().send({
      text: "hỏi",
      mentions: [{ id: "n1", title: "Roadmap", body: "cũ" }],
      attachments: [
        { id: "a1", name: "u.png", originalName: "x.png", size: 1, kind: "image" },
        { id: "a2", name: "d.pdf", originalName: "d.pdf", size: 2, kind: "document", text: "cũ" },
      ],
    });
    readNoteMock.mockResolvedValueOnce({ id: "n1", title: "Roadmap", body: "mới" } as never);
    let seen: { content: unknown } | null = null;
    runAgentMock.mockImplementation(async ({ messages }) => {
      seen = { content: messages.at(-1)!.content };
      return { content: "ok2", messages: [], pendingDeletes: [] };
    });
    await useChatStore.getState().retryLast();

    expect(readNoteMock).toHaveBeenCalledWith("n1");
    expect(attachmentsApi.prepareImage).toHaveBeenCalledWith("u.png");
    expect(attachmentsApi.extractText).toHaveBeenCalledWith("d.pdf");
    const raw = seen!.content;
    const content = typeof raw === "string" ? raw : ((raw as { type: string; text?: string }[]).find((p) => p.type === "text")?.text ?? "");
    expect(content).toContain("mới");
    expect(content).toContain("text-of-d.pdf");
    // retry drops the old exchange and re-sends: one exchange remains
    expect(useChatStore.getState().messages).toHaveLength(2);
  });

  it("retry restores the exchange when re-send is rejected", async () => {
    runAgentMock.mockImplementation(async () => ({ content: "ok", messages: [], pendingDeletes: [] }));
    await send("câu hỏi");
    useSettingsStore.setState({ providers: [] }); // next send fails validation
    await useChatStore.getState().retryLast();
    expect(useChatStore.getState().messages).toHaveLength(2); // exchange restored
  });

  it("retry does not restore a stale exchange after switching chats", async () => {
    let resolveImage!: (value: string) => void;
    vi.mocked(attachmentsApi.prepareImage).mockImplementationOnce(
      () => new Promise<string>((resolve) => { resolveImage = resolve; }),
    );
    useChatStore.setState({
      chatId: "old-chat",
      messages: [
        {
          id: "old-user",
          role: "user",
          content: "hỏi lại",
          attachments: [{ id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image" }],
        },
        { id: "old-assistant", role: "assistant", content: "trả lời cũ" },
      ],
    });

    const retry = useChatStore.getState().retryLast();
    await vi.waitFor(() => expect(attachmentsApi.prepareImage).toHaveBeenCalled());
    await useChatStore.getState().newChat();
    resolveImage("data:image/png;base64,reloaded");
    await retry;

    expect(useChatStore.getState().chatId).not.toBe("old-chat");
    expect(useChatStore.getState().messages).toEqual([]);
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it("retry reports unavailable attachments without sending stale transient content", async () => {
    vi.mocked(attachmentsApi.prepareImage).mockRejectedValueOnce(new Error("missing image"));
    vi.mocked(attachmentsApi.extractText).mockRejectedValueOnce(new Error("missing document"));
    useChatStore.setState({
      messages: [
        {
          id: "old-user",
          role: "user",
          content: "hỏi lại",
          attachments: [
            {
              id: "a1",
              name: "u.png",
              originalName: "x.png",
              size: 3,
              kind: "image",
              previewUrl: "data:image/png;base64,STALE",
            },
            {
              id: "a2",
              name: "d.pdf",
              originalName: "d.pdf",
              size: 5,
              kind: "document",
              text: "stale document body",
            },
          ],
        },
        { id: "old-assistant", role: "assistant", content: "trả lời cũ" },
      ],
    });
    runAgentMock.mockResolvedValue({ content: "ok", messages: [], pendingDeletes: [] });

    await useChatStore.getState().retryLast();

    const currentContent = runAgentMock.mock.calls[0]![0].messages.at(-1)!.content;
    expect(typeof currentContent).toBe("string");
    expect(currentContent).toContain("[Image unavailable: x.png]");
    expect(currentContent).toContain("[File unavailable: d.pdf]");
    expect(currentContent).not.toContain("stale document body");
    expect(JSON.stringify(currentContent)).not.toContain("STALE");
    expect(useChatStore.getState().messages[0]!.attachments).toEqual([
      { id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image" },
      { id: "a2", name: "d.pdf", originalName: "d.pdf", size: 5, kind: "document" },
    ]);
  });

  it("owns and cancels retry preparation before starting another retry", async () => {
    vi.mocked(attachmentsApi.prepareImage).mockImplementationOnce(() => new Promise<string>(() => {}));
    useChatStore.setState({
      messages: [
        {
          id: "old-user",
          role: "user",
          content: "hỏi lại",
          attachments: [{ id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image" }],
        },
        { id: "old-assistant", role: "assistant", content: "trả lời cũ" },
      ],
    });

    const first = useChatStore.getState().retryLast();
    await vi.waitFor(() => expect(attachmentsApi.prepareImage).toHaveBeenCalledTimes(1));
    expect(useChatStore.getState().status).toBe("streaming");
    await useChatStore.getState().retryLast();
    expect(attachmentsApi.prepareImage).toHaveBeenCalledTimes(1);
    useChatStore.getState().stop();
    await first;

    expect(useChatStore.getState().status).toBe("idle");
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it("stop aborts the active run; a quick resend is not clobbered", async () => {
    const hanging = ({ signal }: { signal?: AbortSignal }) =>
      new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    runAgentMock.mockImplementationOnce(hanging as never);
    const first = useChatStore.getState().send({ text: "thứ nhất", mentions: [], attachments: [] });
    await vi.waitFor(() => expect(useChatStore.getState().status).toBe("streaming"));

    useChatStore.getState().stop();
    await first; // aborted → finally sets idle, persists partial

    runAgentMock.mockImplementationOnce(async () => ({ content: "hai", messages: [], pendingDeletes: [] }));
    const second = await useChatStore.getState().send({ text: "thứ hai", mentions: [], attachments: [] });
    expect(second).toEqual({ ok: true });
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(4);
    expect(msgs[2]!.content).toBe("thứ hai");
    expect(useChatStore.getState().status).toBe("idle");
  });

  it("retryLast resends the last user message without duplicating it", async () => {
    runAgentMock.mockImplementation(async ({ onEvent }) => {
      onEvent?.({ type: "done", content: "trả lời" });
      return { content: "trả lời", messages: [], pendingDeletes: [] };
    });
    await send("câu hỏi");
    await useChatStore.getState().retryLast();
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe("câu hỏi");
    expect(runAgentMock).toHaveBeenCalledTimes(2);
  });

  it("deleteChat removes the session and resets when it was open", async () => {
    const id = useChatStore.getState().chatId;
    useChatStore.setState({ sessions: [{ id, title: "x", updated: "" }] });
    await useChatStore.getState().deleteChat(id);
    expect(api.chats.del).toHaveBeenCalledWith(id);
    expect(useChatStore.getState().sessions).toHaveLength(0);
    expect(useChatStore.getState().chatId).not.toBe(id);
  });

  it("newChat resets messages; stop without a run is a no-op", async () => {
    await useChatStore.getState().newChat();
    expect(useChatStore.getState().messages).toHaveLength(0);
    useChatStore.getState().stop();
    expect(useChatStore.getState().status).toBe("idle");
  });
});
