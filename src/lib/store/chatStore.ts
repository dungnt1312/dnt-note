import { create } from "zustand";
import { runAgent, buildSystemPrompt, type AgentEvent } from "../agent/engine";
import { useSettingsStore } from "./settingsStore";
import { useNotesStore } from "./notesStore";
import { useUi } from "./uiStore";
import { api, type ChatMetaDto, type ChatSessionDto } from "../api/chats";

export interface UiToolCall {
  id: string;
  name: string;
  args: string;
  result?: string;
  status: "running" | "done";
}

export interface UiMention {
  id: string;
  title: string;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  mentions?: UiMention[];
  toolCalls?: UiToolCall[];
  pendingDelete?: { id: string; title: string; status: "pending" | "confirmed" | "cancelled" };
  error?: string;
}

export type MentionInput = { id: string; title: string; body: string };

interface ChatState {
  chatId: string;
  chatTitle: string;
  messages: UiMessage[];
  status: "idle" | "streaming";
  error: string | null;
  sessions: ChatMetaDto[];
  send: (text: string, mentions: MentionInput[]) => Promise<void>;
  /** Drop the last exchange and send the same user message again. */
  retryLast: () => Promise<void>;
  confirmDelete: (noteId: string) => Promise<void>;
  cancelDelete: (noteId: string) => void;
  newChat: () => Promise<void>;
  loadChat: (id: string) => Promise<void>;
  loadSessions: () => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  stop: () => void;
}

export function newId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const NEW_CHAT_TITLE = "Phiên chat mới";
const MAX_CONTEXT_CHARS = 8000;
let controller: AbortController | null = null;
/** Mention bodies of the last send, so "retry" can rebuild the same context. */
let lastMentions: MentionInput[] = [];

function sessionTitle(messages: UiMessage[], chatTitle: string): string {
  if (chatTitle !== NEW_CHAT_TITLE) return chatTitle;
  const firstUser = messages.find((m) => m.role === "user");
  const raw = (firstUser?.content ?? "").replace(/\s+/g, " ").trim();
  return raw ? raw.slice(0, 60) : NEW_CHAT_TITLE;
}

async function persistChat(messages: UiMessage[], chatId: string, title: string): Promise<ChatMetaDto | null> {
  const session: ChatSessionDto = {
    id: chatId,
    title,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content + (m.error ? `\n\n⚠ ${m.error}` : ""),
    })),
    updated: new Date().toISOString(),
  };
  try {
    await api.chats.save(session);
    return { id: session.id, title: session.title, updated: session.updated };
  } catch (e) {
    console.error("chat save failed", e);
    return null;
  }
}

export const useChatStore = create<ChatState>()((set, get) => ({
  chatId: newId(),
  chatTitle: NEW_CHAT_TITLE,
  messages: [],
  status: "idle",
  error: null,
  sessions: [],

  send: async (text, mentions) => {
    if (get().status === "streaming" || !text.trim()) return;
    const provider = useSettingsStore.getState().activeProvider();
    if (!provider) {
      set({ error: "Chưa cấu hình provider AI — mở Cài đặt → Nhà cung cấp AI." });
      return;
    }
    lastMentions = mentions;

    let userContent = text;
    for (const m of mentions) {
      const body = m.body.length > MAX_CONTEXT_CHARS ? `${m.body.slice(0, MAX_CONTEXT_CHARS)}…` : m.body;
      userContent += `\n\n[@${m.title}]\n---\n${body}`;
    }

    const userMsg: UiMessage = {
      id: newId(),
      role: "user",
      content: text,
      mentions: mentions.length ? mentions.map(({ id, title }) => ({ id, title })) : undefined,
    };
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
      const notesState = useNotesStore.getState();
      const stats = {
        total: notesState.notes.length,
        pinned: notesState.notes.filter((n) => n.pinned).length,
        words: 0,
        tags: notesState.tags.length,
      };
      const selectedId = notesState.selectedId;
      const selectedTitle = notesState.notes.find((n) => n.id === selectedId)?.title ?? null;

      const history: Parameters<typeof runAgent>[0]["messages"] = get()
        .messages.slice(0, -2)
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
      const aborted = e instanceof DOMException && e.name === "AbortError";
      if (!aborted) {
        const message = e instanceof Error ? e.message : String(e);
        updateAssistant((m) => ({ ...m, error: message }));
      }
    } finally {
      controller = null;
      set({ status: "idle" });
      const s = get();
      const title = sessionTitle(s.messages, s.chatTitle);
      const meta = await persistChat(s.messages, s.chatId, title);
      if (meta && get().chatId === meta.id) {
        set((cur) => ({
          chatTitle: title,
          sessions: [meta, ...cur.sessions.filter((x) => x.id !== meta.id)],
        }));
      }
    }
  },

  retryLast: async () => {
    const { messages, status } = get();
    if (status === "streaming") return;
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx < 0) return;
    const text = messages[lastUserIdx].content;
    set({ messages: messages.slice(0, lastUserIdx) });
    await get().send(text, lastMentions);
  },

  confirmDelete: async (noteId) => {
    markDelete(set, noteId, "confirmed");
    await useNotesStore.getState().del(noteId);
    useUi.getState().pushToast({
      message: "Đã xóa ghi chú",
      actionLabel: "Hoàn tác",
      onAction: () => void useNotesStore.getState().undoDelete(),
    });
  },

  cancelDelete: (noteId) => markDelete(set, noteId, "cancelled"),

  newChat: async () => {
    get().stop();
    set({ chatId: newId(), chatTitle: NEW_CHAT_TITLE, messages: [], status: "idle", error: null });
  },

  loadChat: async (id) => {
    if (id === get().chatId) return;
    get().stop();
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

  loadSessions: async () => {
    try {
      const list = await api.chats.list();
      set({ sessions: [...list].sort((a, b) => b.updated.localeCompare(a.updated)) });
    } catch (e) {
      console.error("list chats failed", e);
    }
  },

  renameChat: async (id, title) => {
    const clean = title.trim();
    if (!clean) return;
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, title: clean } : x)),
      chatTitle: s.chatId === id ? clean : s.chatTitle,
    }));
    try {
      const session = await api.chats.load(id);
      await api.chats.save({ ...session, title: clean });
    } catch (e) {
      console.error("rename chat failed", e);
    }
  },

  deleteChat: async (id) => {
    try {
      await api.chats.del(id);
    } catch (e) {
      console.error("delete chat failed", e);
    }
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) }));
    if (get().chatId === id) await get().newChat();
  },

  stop: () => {
    controller?.abort();
    controller = null;
    set({ status: "idle" });
  },
}));

function markDelete(
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
  noteId: string,
  status: "confirmed" | "cancelled",
): void {
  set((s) => ({
    messages: s.messages.map((m) =>
      m.pendingDelete?.id === noteId ? { ...m, pendingDelete: { ...m.pendingDelete, status } } : m,
    ),
  }));
}
