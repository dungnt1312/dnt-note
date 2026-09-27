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
const readNoteMock = vi.mocked(notesApi.notes.read);

const send = (text: string, mentions: MentionInput[] = []) =>
  useChatStore.getState().send({ text, mentions, attachments: [] });

describe("chatStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("images ride the current turn as OpenAI parts; history stays plain text", async () => {
    runAgentMock.mockImplementation(async ({ messages }) => {
      const last = messages.at(-1)!;
      expect(Array.isArray(last.content)).toBe(true);
      const parts = last.content as { type: string; image_url?: { url: string } }[];
      expect(parts[0]!.type).toBe("text");
      expect(parts.filter((p) => p.type === "image_url")).toHaveLength(1);
      return { content: "ok", messages: [], pendingDeletes: [] };
    });
    const res = await useChatStore.getState().send({
      text: "ảnh này là gì",
      mentions: [],
      attachments: [
        { id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image", previewUrl: "data:image/png;base64,AA" },
      ],
    });
    expect(res).toEqual({ ok: true });
    expect(useChatStore.getState().messages[0]!.attachments![0]).toMatchObject({ name: "u.png", kind: "image" });

    // Follow-up turn: prior image message degrades to text in history.
    runAgentMock.mockImplementation(async ({ messages }) => {
      expect(typeof messages[0]!.content).toBe("string");
      return { content: "ok2", messages: [], pendingDeletes: [] };
    });
    await send("tiếp theo");
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
    expect(m.pendingDelete).toMatchObject({ id: "n9", status: "pending" });

    await useChatStore.getState().confirmDelete("n9");
    expect(useChatStore.getState().messages[1].pendingDelete?.status).toBe("confirmed");
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
      attachments: [{ id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image", previewUrl: "data:…" }],
    });
    const saved = saveMock.mock.calls.at(-1)![0] as { messages: { mentions?: unknown[]; attachments?: unknown[] }[] };
    expect(saved.messages[0]!.mentions).toEqual([{ id: "n1", title: "Roadmap" }]);
    expect(saved.messages[0]!.attachments).toEqual([{ id: "a1", name: "u.png", originalName: "x.png", size: 3, kind: "image" }]);
    expect(JSON.stringify(saved)).not.toContain("data:…"); // transient preview never persisted

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
