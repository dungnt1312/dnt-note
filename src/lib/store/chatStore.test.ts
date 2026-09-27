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
    },
  },
}));

import { runAgent, buildSystemPrompt } from "../agent/engine";
import { useSkillsStore } from "./skillsStore";
import { api } from "../api/chats";
import { useChatStore, newId, buildUserContent } from "./chatStore";
import { useSettingsStore } from "./settingsStore";

const runAgentMock = vi.mocked(runAgent);
const saveMock = vi.mocked(api.chats.save);

describe("chatStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      providers: [{ id: "p1", name: "Test", baseUrl: "http://x", model: "m", apiKey: "k" }],
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

    await useChatStore.getState().send("hi", []);
    const s = useChatStore.getState();
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0]).toMatchObject({ role: "user", content: "hi" });
    expect(s.messages[1]).toMatchObject({ role: "assistant", content: "Xin chào bạn!" });
    expect(s.status).toBe("idle");
    expect(saveMock).toHaveBeenCalled();
  });

  it("tool events appear as toolCalls on the assistant message", async () => {
    runAgentMock.mockImplementation(async ({ onEvent }) => {
      onEvent?.({ type: "tool_start", id: "c1", name: "read_note", args: '{"id":"n1"}' });
      onEvent?.({ type: "tool_result", id: "c1", name: "read_note", result: '{"body":"x"}' });
      onEvent?.({ type: "done", content: "xong" });
      return { content: "xong", messages: [], pendingDeletes: [] };
    });

    await useChatStore.getState().send("đọc n1", []);
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

    await useChatStore.getState().send("xóa n9", []);
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

    await useChatStore.getState().send("hi", []);
    const s = useChatStore.getState();
    expect(s.messages[1].error).toContain("401");
    expect(s.status).toBe("idle");
  });

  it("mentions are appended as note context", async () => {
    runAgentMock.mockImplementation(async ({ messages }) => {
      expect(messages.at(-1)?.content).toContain("[@Tài liệu]");
      return { content: "ok", messages: [], pendingDeletes: [] };
    });
    await useChatStore.getState().send("tóm tắt", [
      { id: "n1", title: "Tài liệu", body: "nội dung tài liệu" },
    ]);
    const user = useChatStore.getState().messages[0];
    expect(user.content).toBe("tóm tắt");
    expect(user.mentions).toEqual([{ id: "n1", title: "Tài liệu" }]);
  });

  it("first exchange names the session and adds it to the session list", async () => {
    useChatStore.setState({ sessions: [] });
    runAgentMock.mockImplementation(async () => ({ content: "ok", messages: [], pendingDeletes: [] }));
    await useChatStore.getState().send("Lên kế hoạch   tuần này", []);
    const s = useChatStore.getState();
    expect(s.chatTitle).toBe("Lên kế hoạch tuần này");
    expect(s.sessions[0]).toMatchObject({ id: s.chatId, title: "Lên kế hoạch tuần này" });
  });

  it("retryLast resends the last user message without duplicating it", async () => {
    runAgentMock.mockImplementation(async ({ onEvent }) => {
      onEvent?.({ type: "done", content: "trả lời" });
      return { content: "trả lời", messages: [], pendingDeletes: [] };
    });
    await useChatStore.getState().send("câu hỏi", []);
    await useChatStore.getState().retryLast();
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe("câu hỏi");
    expect(runAgentMock).toHaveBeenCalledTimes(2);
  });

  it("retryLast resends the same files", async () => {
    runAgentMock.mockImplementation(async () => ({ content: "ok", messages: [], pendingDeletes: [] }));
    const files = [{ name: "u-a.png", kind: "image" as const, dataUrl: "data:image/png;base64,AA" }];
    await useChatStore.getState().send("xem ảnh", [], files);
    await useChatStore.getState().retryLast();
    const last = runAgentMock.mock.calls[1][0].messages.at(-1);
    expect(Array.isArray(last?.content)).toBe(true);
    expect(useChatStore.getState().messages[0].files).toEqual([{ name: "u-a.png", kind: "image" }]);
  });

  it("retryLast resends the same skills and system prompt gets enabled skills", async () => {
    runAgentMock.mockImplementation(async () => ({ content: "ok", messages: [], pendingDeletes: [] }));
    useSkillsStore.setState({
      skills: [
        { name: "a", description: "A", enabled: true },
        { name: "b", description: "B", enabled: false },
      ],
      loaded: true,
    });
    await useChatStore.getState().send("làm", [], [], [{ name: "a", body: "HD" }]);
    await useChatStore.getState().retryLast();
    const last = runAgentMock.mock.calls[1][0].messages.at(-1);
    expect(last?.content).toBe("[Skill: a]\nHD\n---\nlàm");
    expect(useChatStore.getState().messages[0].skills).toEqual(["a"]);
    expect(vi.mocked(buildSystemPrompt).mock.calls.at(-1)?.[3]).toEqual([{ name: "a", description: "A" }]);
    const saved = saveMock.mock.calls.at(-1)?.[0];
    expect(saved?.messages[0].content).toBe("làm\n\n[⚡ a]");
  });

  it("newChat/loadChat clear retry context so files are not resent", async () => {
    runAgentMock.mockImplementation(async () => ({ content: "ok", messages: [], pendingDeletes: [] }));
    await useChatStore.getState().send("a", [{ id: "n", title: "T", body: "b" }], [
      { name: "u-a.png", kind: "image", dataUrl: "data:x" },
    ]);
    await useChatStore.getState().newChat();
    useChatStore.setState({ messages: [{ id: "m1", role: "user", content: "khác" }] });
    await useChatStore.getState().retryLast();
    expect(runAgentMock.mock.calls[1][0].messages.at(-1)?.content).toBe("khác");

    await useChatStore.getState().send("b", [], [{ name: "u-b.png", kind: "image", dataUrl: "data:y" }]);
    await useChatStore.getState().loadChat("c1");
    useChatStore.setState({ messages: [{ id: "m2", role: "user", content: "x" }] });
    await useChatStore.getState().retryLast();
    expect(runAgentMock.mock.calls.at(-1)?.[0].messages.at(-1)?.content).toBe("x");
  });

  it("sends with empty text when files are attached", async () => {
    runAgentMock.mockImplementation(async () => ({ content: "ok", messages: [], pendingDeletes: [] }));
    await useChatStore.getState().send("", [], [{ name: "u-d.pdf", kind: "document", text: "t" }]);
    expect(runAgentMock).toHaveBeenCalledTimes(1);
    const user = useChatStore.getState().messages[0];
    expect(user.content).toBe("");
    expect(user.files).toEqual([{ name: "u-d.pdf", kind: "document" }]);
    expect(saveMock.mock.calls.at(-1)?.[0].messages[0].content).toBe("[📎 u-d.pdf]");
  });

  it("ignores empty text without files", async () => {
    await useChatStore.getState().send("  ", []);
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it("persists user files as text markers, not base64", async () => {
    runAgentMock.mockImplementation(async () => ({ content: "ok", messages: [], pendingDeletes: [] }));
    await useChatStore.getState().send("q", [], [{ name: "u-a.png", kind: "image", dataUrl: "data:x" }]);
    const saved = saveMock.mock.calls.at(-1)?.[0];
    expect(saved?.messages[0].content).toBe("q\n\n[📎 u-a.png]");
  });

  it("deleteChat removes the session and resets when it was open", async () => {
    const id = useChatStore.getState().chatId;
    useChatStore.setState({ sessions: [{ id, title: "x", updated: "" }] });
    await useChatStore.getState().deleteChat(id);
    expect(api.chats.del).toHaveBeenCalledWith(id);
    expect(useChatStore.getState().sessions).toHaveLength(0);
    expect(useChatStore.getState().chatId).not.toBe(id);
  });

  it("newChat resets messages; stop aborts", async () => {
    await useChatStore.getState().newChat();
    expect(useChatStore.getState().messages).toHaveLength(0);
    useChatStore.getState().stop();
    expect(useChatStore.getState().status).toBe("idle");
  });
});

describe("buildUserContent", () => {
  it("returns plain string with mentions and documents when no images", () => {
    const out = buildUserContent("hỏi", [{ id: "n", title: "A", body: "nội dung" }], [
      { name: "doc.pdf", kind: "document", text: "y".repeat(25000) },
    ]);
    expect(typeof out).toBe("string");
    const s = out as string;
    expect(s.startsWith("hỏi\n\n[@A]\n---\nnội dung\n\n[📎 doc.pdf]\n---\n")).toBe(true);
    expect(s.length).toBe("hỏi\n\n[@A]\n---\nnội dung\n\n[📎 doc.pdf]\n---\n".length + 20000);
  });

  it("returns content parts when images are present", () => {
    const out = buildUserContent("xem", [], [
      { name: "a.png", kind: "image", dataUrl: "data:image/png;base64,AA" },
    ]);
    expect(out).toEqual([
      { type: "text", text: "xem" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA" } },
    ]);
  });

  it("prefixes skill bodies before the user text", () => {
    expect(buildUserContent("hi", [], [], [{ name: "x", body: "B1" }, { name: "y", body: "B2" }])).toBe(
      "[Skill: x]\nB1\n---\n[Skill: y]\nB2\n---\nhi",
    );
  });

  it("returns the text unchanged with nothing attached", () => {
    expect(buildUserContent("hi", [], [])).toBe("hi");
  });
});
