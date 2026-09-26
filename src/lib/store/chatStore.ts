import { create } from "zustand";
import { runAgent, buildSystemPrompt, type AgentEvent } from "../agent/engine";
import { useSettingsStore } from "./settingsStore";
import { useNotesStore } from "./notesStore";
import { useUi } from "./uiStore";
import { api, type ChatSessionDto } from "../api/chats";

export interface UiToolCall {
  id: string;
  name: string;
  args: string;
  result?: string;
  status: "running" | "done";
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: UiToolCall[];
  pendingDelete?: { id: string; title: string; status: "pending" | "confirmed" | "cancelled" };
  error?: string;
}

interface ChatState {
  chatId: string;
  chatTitle: string;
  messages: UiMessage[];
  status: "idle" | "streaming";
  error: string | null;
  send: (text: string, mentions: { id: string; title: string; body: string }[]) => Promise<void>;
  confirmDelete: (noteId: string) => Promise<void>;
  cancelDelete: (noteId: string) => void;
  newChat: () => Promise<void>;
  loadChat: (id: string) => Promise<void>;
  stop: () => void;
}

export function newId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const MAX_CONTEXT_CHARS = 8000;
let controller: AbortController | null = null;

async function persistChat(messages: UiMessage[], chatId: string, chatTitle: string): Promise<void> {
  const firstUser = messages.find((m) => m.role === "user");
  const session: ChatSessionDto = {
    id: chatId,
    title: chatTitle !== "Phiên chat mới" ? chatTitle : (firstUser?.content ?? "Phiên chat").slice(0, 60),
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content + (m.error ? `\n\n⚠ ${m.error}` : ""),
    })),
    updated: new Date().toISOString(),
  };
  try {
    await api.chats.save(session);
  } catch (e) {
    console.error("chat save failed", e);
  }
}

export const useChatStore = create<ChatState>()((set, get) => ({
  chatId: newId(),
  chatTitle: "Phiên chat mới",
  messages: [],
  status: "idle",
  error: null,

  send: async (text, mentions) => {
    if (get().status === "streaming" || !text.trim()) return;
    const provider = useSettingsStore.getState().activeProvider();
    if (!provider) {
      set({ error: "Chưa cấu hình provider AI — mở Cài đặt → AI Providers." });
      return;
    }

    let userContent = text;
    for (const m of mentions) {
      const body = m.body.length > MAX_CONTEXT_CHARS ? `${m.body.slice(0, MAX_CONTEXT_CHARS)}…` : m.body;
      userContent += `\n\n[@${m.title}]\n---\n${body}`;
    }

    const userMsg: UiMessage = { id: newId(), role: "user", content: text + (mentions.length ? ` (${mentions.length} note đính kèm)` : "") };
    const assistantId = newId();
    const assistantMsg: UiMessage = { id: assistantId, role: "assistant", content: "" };

    set((s) => ({
      messages: [...s.messages, userMsg, assistantMsg],
      status: "streaming",
      error: null,
    }));

    controller = new AbortController();

    const updateAssistant = (fn: (m: UiMessage) => UiMessage) => {
      set((s) => ({
        messages: s.messages.map((m) => (m.id === assistantId ? fn(m) : m)),
      }));
    };

    const handleEvent = (e: AgentEvent) => {
      switch (e.type) {
        case "delta":
          updateAssistant((m) => ({ ...m, content: m.content + e.content }));
          break;
        case "tool_start":
          updateAssistant((m) => ({
            ...m,
            toolCalls: [...(m.toolCalls ?? []), { id: e.id, name: e.name, args: e.args, status: "running" }],
          }));
          break;
        case "tool_result":
          updateAssistant((m) => ({
            ...m,
            toolCalls: (m.toolCalls ?? []).map((tc) =>
              tc.id === e.id ? { ...tc, result: e.result, status: "done" as const } : tc,
            ),
          }));
          break;
        case "pending_delete":
          updateAssistant((m) => ({
            ...m,
            pendingDelete: { id: e.id, title: e.title, status: "pending" },
          }));
          break;
        case "error":
          updateAssistant((m) => ({ ...m, error: e.message }));
          break;
        case "done":
          updateAssistant((m) => (m.content ? m : { ...m, content: e.content }));
          break;
      }
    };

    try {
      const stats = await useNotesStore.getState().notes.length !== 0
        ? { total: useNotesStore.getState().notes.length, pinned: 0, words: 0, tags: useNotesStore.getState().tags.length }
        : { total: 0, pinned: 0, words: 0, tags: 0 };
      const selectedId = useNotesStore.getState().selectedId;
      const selectedTitle = useNotesStore.getState().notes.find((n) => n.id === selectedId)?.title ?? null;

      const history: Parameters<typeof runAgent>[0]["messages"] = get().messages
        .slice(0, -2)
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content }) as Parameters<typeof runAgent>[0]["messages"][number]);

      await runAgent({
        provider,
        messages: [...history, { role: "user", content: userContent }],
        systemPrompt: buildSystemPrompt(stats, selectedId, selectedTitle),
        signal: controller.signal,
        onEvent: handleEvent,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      updateAssistant((m) => ({ ...m, error: message }));
    } finally {
      controller = null;
      set({ status: "idle" });
      const s = get();
      await persistChat(s.messages, s.chatId, s.chatTitle);
    }
  },

  confirmDelete: async (noteId) => {
    markDelete(get, set, noteId, "confirmed");
    await useNotesStore.getState().del(noteId);
    useUi.getState().pushToast({
      message: "Đã xóa ghi chú",
      actionLabel: "Hoàn tác (Ctrl+Z)",
      onAction: () => void useNotesStore.getState().undoDelete(),
    });
  },

  cancelDelete: (noteId) => markDelete(get, set, noteId, "cancelled"),

  newChat: async () => {
    set({ chatId: newId(), chatTitle: "Phiên chat mới", messages: [], status: "idle", error: null });
  },

  loadChat: async (id) => {
    try {
      const session = await api.chats.load(id);
      set({
        chatId: session.id,
        chatTitle: session.title,
        messages: session.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ id: newId(), role: m.role as "user" | "assistant", content: m.content ?? "" })),
        status: "idle",
        error: null,
      });
    } catch (e) {
      console.error("load chat failed", e);
    }
  },

  stop: () => {
    controller?.abort();
    controller = null;
    set({ status: "idle" });
  },
}));

function markDelete(
  get: () => ChatState,
  set: (fn: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  noteId: string,
  status: "confirmed" | "cancelled",
): void {
  set((s) => ({
    messages: s.messages.map((m) =>
      m.pendingDelete?.id === noteId ? { ...m, pendingDelete: { ...m.pendingDelete, status } } : m,
    ),
  }));
  void get;
}
