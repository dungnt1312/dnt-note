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

import { runAgent } from "../agent/engine";
import { api } from "../api/chats";
import { useChatStore, newId } from "./chatStore";
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
    expect(useChatStore.getState().messages[0].content).toContain("tóm tắt");
  });

  it("newChat resets messages; stop aborts", async () => {
    await useChatStore.getState().newChat();
    expect(useChatStore.getState().messages).toHaveLength(0);
    useChatStore.getState().stop();
    expect(useChatStore.getState().status).toBe("idle");
  });
});
