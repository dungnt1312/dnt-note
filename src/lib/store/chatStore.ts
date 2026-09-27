import { create } from "zustand";
import { runAgent, buildSystemPrompt, type AgentEvent } from "../agent/engine";
import { useSettingsStore } from "./settingsStore";
import { useNotesStore } from "./notesStore";
import { useUi } from "./uiStore";
import { api, type ChatAttachmentDto, type ChatMentionDto, type ChatSessionDto, type ChatMetaDto } from "../api/chats";
import { api as notesApi } from "../api/notes";
import { attachmentsApi } from "../api/attachments";
import { buildRequestUserMessage, MAX_DOC_CHARS, type AttachmentInput, type MentionInput } from "../chat/payload";

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
  /** The note body could not be read when this message was sent. */
  failed?: boolean;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  mentions?: UiMention[];
  attachments?: AttachmentInput[];
  toolCalls?: UiToolCall[];
  pendingDelete?: { id: string; title: string; status: "pending" | "confirmed" | "cancelled" };
  error?: string;
}

export type { MentionInput, AttachmentInput } from "../chat/payload";

export interface SendPayload {
  text: string;
  mentions: MentionInput[];
  attachments: AttachmentInput[];
}
export type SendResult = { ok: true } | { ok: false; error: string };

interface ChatState {
  chatId: string;
  chatTitle: string;
  messages: UiMessage[];
  status: "idle" | "streaming";
  error: string | null;
  sessions: ChatMetaDto[];
  /** Validate, then stream. Returns `{ok:false}` without touching state on rejection. */
  send: (payload: SendPayload) => Promise<SendResult>;
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

/** One AbortController per run; only the active run may flip status/persist. */
const controllers = new Map<string, AbortController>();
let activeRunId: string | null = null;

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
      content: m.content,
      ...(m.mentions?.length ? { mentions: m.mentions as ChatMentionDto[] } : {}),
      ...(m.attachments?.length
        ? {
            attachments: m.attachments.map(({ id, name, originalName, size, kind }) => ({
              id,
              name,
              originalName,
              size,
              kind,
            })) as ChatAttachmentDto[],
          }
        : {}),
      ...(m.error ? { error: m.error } : {}),
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

  send: async (payload) => {
    if (get().status === "streaming") {
      return { ok: false, error: "Trợ lý đang trả lời — vui lòng dừng trước khi gửi tiếp." };
    }
    if (!payload.text.trim() && payload.attachments.length === 0) {
      return { ok: false, error: "Nhập nội dung hoặc đính kèm file trước khi gửi." };
    }
    const provider = useSettingsStore.getState().activeProvider();
    if (!provider) {
      const error = "Chưa cấu hình provider AI — mở Cài đặt → Nhà cung cấp AI.";
      set({ error });
      return { ok: false, error };
    }
    if (!provider.model) {
      const error = `“${provider.name}” chưa có model nào — mở Cài đặt → Nhà cung cấp AI để thêm model.`;
      set({ error });
      return { ok: false, error };
    }

    // Prior turns are sent as plain text; images/docs only ride the current turn.
    const history = get()
      .messages.filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

    const requestUser = buildRequestUserMessage(payload.text, payload.mentions, payload.attachments);
    const userMsg: UiMessage = {
      id: newId(),
      role: "user",
      content: payload.text,
      ...(payload.mentions.length
        ? {
            mentions: payload.mentions.map(({ id, title, failed }) =>
              failed ? { id, title, failed } : { id, title },
            ),
          }
        : {}),
      ...(payload.attachments.length ? { attachments: payload.attachments } : {}),
    };
    const assistantId = newId();
    const assistantMsg: UiMessage = { id: assistantId, role: "assistant", content: "" };

    set((s) => ({
      messages: [...s.messages, userMsg, assistantMsg],
      status: "streaming",
      error: null,
    }));

    const runId = newId();
    activeRunId = runId;
    const controller = new AbortController();
    controllers.set(runId, controller);

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

      await runAgent({
        provider,
        messages: [...history, requestUser],
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
      controllers.delete(runId);
      if (activeRunId === runId) {
        activeRunId = null;
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
    }
    return { ok: true };
  },

  retryLast: async () => {
    const { messages, status } = get();
    if (status === "streaming") return;
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx < 0) return;
    const msg = messages[lastUserIdx]!;

    // Re-resolve context from the message itself — note bodies may have changed.
    const mentions: MentionInput[] = await Promise.all(
      (msg.mentions ?? []).map(async (m) => {
        try {
          const note = await notesApi.notes.read(m.id);
          return { id: m.id, title: m.title, body: note.body, ...(m.failed ? { failed: true } : {}) };
        } catch {
          return { id: m.id, title: m.title, body: "", failed: true };
        }
      }),
    );
    const attachments: AttachmentInput[] = await Promise.all(
      (msg.attachments ?? []).map(async (a) => {
        try {
          if (a.kind === "image") return { ...a, previewUrl: await attachmentsApi.prepareImage(a.name) };
          return { ...a, text: (await attachmentsApi.extractText(a.name)).slice(0, MAX_DOC_CHARS) };
        } catch {
          return { ...a };
        }
      }),
    );

    set({ messages: messages.slice(0, lastUserIdx) });
    const res = await get().send({ text: msg.content, mentions, attachments });
    if (!res.ok) set({ messages }); // validation failed — restore the exchange
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
          .map((m) => ({
            id: newId(),
            role: m.role as "user" | "assistant",
            content: m.content ?? "",
            ...(m.mentions?.length ? { mentions: m.mentions } : {}),
            ...(m.attachments?.length ? { attachments: m.attachments } : {}),
            ...(m.error ? { error: m.error } : {}),
          })),
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
    if (activeRunId) controllers.get(activeRunId)?.abort();
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
