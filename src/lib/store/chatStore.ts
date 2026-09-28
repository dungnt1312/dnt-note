import { create } from "zustand";
import { getT } from "../i18n";
import { runAgent, buildSystemPrompt, type AgentEvent } from "../agent/engine";
import { useSettingsStore } from "./settingsStore";
import { useNotesStore } from "./notesStore";
import { useUi } from "./uiStore";
import { api, type ChatAttachmentDto, type ChatMentionDto, type ChatSessionDto, type ChatMetaDto } from "../api/chats";
import { api as notesApi } from "../api/notes";
import { attachmentsApi } from "../api/attachments";
import { buildRequestUserMessage, MAX_DOC_CHARS, type AttachmentInput, type MentionInput } from "../chat/payload";
import type { ChatMessage } from "../llm/openai";

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

export interface PendingDelete {
  id: string;
  title: string;
  status: "pending" | "confirmed" | "cancelled";
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  mentions?: UiMention[];
  attachments?: AttachmentInput[];
  toolCalls?: UiToolCall[];
  pendingDelete?: PendingDelete;
  pendingDeletes?: PendingDelete[];
  error?: string;
}

export type { MentionInput, AttachmentInput } from "../chat/payload";

export interface SendPayload {
  text: string;
  /** Optional model-facing text; the visible user message still uses `text`. */
  requestText?: string;
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
  send: (payload: SendPayload, ownedOperation?: ActiveOperation, onAccepted?: () => void) => Promise<SendResult>;
  /** Drop the last exchange and send the same user message again. */
  retryLast: () => Promise<void>;
  confirmDelete: (noteId: string) => Promise<void>;
  cancelDelete: (noteId: string) => Promise<void>;
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

/** One owned async operation at a time; navigation aborts and waits for it. */
interface ActiveOperation {
  id: string;
  controller: AbortController;
  done: Promise<void>;
  resolveDone: () => void;
}

let activeOperation: ActiveOperation | null = null;
const operationQueue: Array<(operation: ActiveOperation) => void> = [];
let navigationVersion = 0;
let pendingNavigationVersion: number | null = null;
const dirtySessions = new Map<string, ChatSessionDto>();

function createOperation(): ActiveOperation {
  let resolveDone!: () => void;
  return {
    id: newId(),
    controller: new AbortController(),
    done: new Promise<void>((resolve) => { resolveDone = resolve; }),
    resolveDone: () => resolveDone(),
  };
}

function activateOperation(resolve?: (operation: ActiveOperation) => void): ActiveOperation {
  const operation = createOperation();
  activeOperation = operation;
  resolve?.(operation);
  return operation;
}

function tryAcquireOperation(): ActiveOperation | null {
  if (activeOperation || operationQueue.length > 0) return null;
  return activateOperation();
}

function acquireOperation(): Promise<ActiveOperation> {
  if (!activeOperation && operationQueue.length === 0) return Promise.resolve(activateOperation());
  return new Promise((resolve) => operationQueue.push(resolve));
}

function finishOperation(operation: ActiveOperation): void {
  if (activeOperation !== operation) return;
  activeOperation = null;
  operation.resolveDone();
  const next = operationQueue.shift();
  if (next) activateOperation(next);
}

function abortActiveOperation(): void {
  activeOperation?.controller.abort();
}

function beginNavigation(): number {
  const version = ++navigationVersion;
  pendingNavigationVersion = version;
  return version;
}

function finishNavigation(version: number): void {
  if (pendingNavigationVersion === version) pendingNavigationVersion = null;
}

async function flushCurrentDirtySession(
  get: () => ChatState,
  set: (state: Partial<ChatState>) => void,
): Promise<boolean> {
  const id = get().chatId;
  if (!dirtySessions.has(id)) return true;
  try {
    const meta = await flushDirtySession(id);
    set({
      error: null,
      ...(meta ? { sessions: [meta, ...get().sessions.filter((session) => session.id !== meta.id)] } : {}),
    });
    return true;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    set({ error });
    return false;
  }
}

function sessionTitle(messages: UiMessage[], chatTitle: string): string {
  if (chatTitle !== NEW_CHAT_TITLE) return chatTitle;
  const firstUser = messages.find((m) => m.role === "user");
  const raw = (firstUser?.content ?? "").replace(/\s+/g, " ").trim();
  return raw ? raw.slice(0, 60) : NEW_CHAT_TITLE;
}

interface ResolvedUserContext {
  mentions: MentionInput[];
  attachments: AttachmentInput[];
  unavailable: string[];
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function awaitWithAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function withUnavailableContext(text: string, unavailable: string[]): string {
  return unavailable.length ? [text, ...unavailable].filter(Boolean).join("\n\n") : text;
}

async function resolveUserContext(
  message: UiMessage,
  options: { signal?: AbortSignal; refreshAttachments?: boolean } = {},
): Promise<ResolvedUserContext> {
  const { signal, refreshAttachments = false } = options;
  throwIfAborted(signal);
  const mentions: MentionInput[] = await Promise.all(
    (message.mentions ?? []).map(async (mention) => {
      try {
        const note = await awaitWithAbort(notesApi.notes.read(mention.id), signal);
        return { id: mention.id, title: mention.title, body: note.body };
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) throw abortError();
        return { id: mention.id, title: mention.title, body: "", failed: true };
      }
    }),
  );
  const attachments: AttachmentInput[] = [];
  const unavailable: string[] = [];

  for (const attachment of message.attachments ?? []) {
    throwIfAborted(signal);
    if (attachment.kind === "image") {
      if (!refreshAttachments && attachment.previewUrl) {
        attachments.push(attachment);
        continue;
      }
      try {
        const previewUrl = await awaitWithAbort(attachmentsApi.prepareImage(attachment.name), signal);
        attachments.push({ ...attachment, previewUrl });
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) throw abortError();
        const { previewUrl: _previewUrl, ...metadata } = attachment;
        attachments.push(metadata);
        unavailable.push(`[Image unavailable: ${attachment.originalName}]`);
      }
      continue;
    }

    if (!refreshAttachments && attachment.text !== undefined) {
      attachments.push({ ...attachment, text: attachment.text.slice(0, MAX_DOC_CHARS) });
      continue;
    }
    try {
      const text = (await awaitWithAbort(attachmentsApi.extractText(attachment.name), signal)).slice(0, MAX_DOC_CHARS);
      attachments.push({ ...attachment, text });
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw abortError();
      const { text: _text, ...metadata } = attachment;
      attachments.push(metadata);
      unavailable.push(`[File unavailable: ${attachment.originalName}]`);
    }
  }

  throwIfAborted(signal);
  return { mentions, attachments, unavailable };
}

async function buildRequestHistory(messages: UiMessage[], signal?: AbortSignal): Promise<ChatMessage[]> {
  const history: ChatMessage[] = [];
  for (const message of messages) {
    throwIfAborted(signal);
    if (message.error) continue;
    if (message.role === "assistant") {
      history.push({ role: "assistant", content: message.content });
      continue;
    }
    const resolved = await resolveUserContext(message, { signal });
    history.push(buildRequestUserMessage(
      withUnavailableContext(message.content, resolved.unavailable),
      resolved.mentions,
      resolved.attachments,
    ));
  }
  return history;
}

function buildChatSession(messages: UiMessage[], chatId: string, title: string): ChatSessionDto {
  return {
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
      ...(m.pendingDeletes?.length ? { pendingDeletes: m.pendingDeletes } : {}),
      ...(!m.pendingDeletes?.length && m.pendingDelete ? { pendingDeletes: [m.pendingDelete] } : {}),
    })),
    updated: new Date().toISOString(),
  };
}

async function saveSession(session: ChatSessionDto): Promise<ChatMetaDto> {
  await api.chats.save(session);
  dirtySessions.delete(session.id);
  return { id: session.id, title: session.title, updated: session.updated };
}

async function flushDirtySession(id: string): Promise<ChatMetaDto | null> {
  const session = dirtySessions.get(id);
  if (!session) return null;
  return saveSession({ ...session, updated: new Date().toISOString() });
}

export const useChatStore = create<ChatState>()((set, get) => ({
  chatId: newId(),
  chatTitle: NEW_CHAT_TITLE,
  messages: [],
  status: "idle",
  error: null,
  sessions: [],

  send: async (payload, ownedOperation, onAccepted) => {
    const releaseOwnedOperation = () => {
      if (ownedOperation && activeOperation === ownedOperation) {
        set({ status: "idle" });
        finishOperation(ownedOperation);
      }
    };
    if (ownedOperation ? activeOperation !== ownedOperation : (
      get().status === "streaming"
      || pendingNavigationVersion !== null
      || activeOperation
      || operationQueue.length > 0
    )) {
      return { ok: false, error: getT()("chat.errBusy") };
    }
    if (!payload.text.trim() && payload.attachments.length === 0) {
      releaseOwnedOperation();
      return { ok: false, error: getT()("chat.errEmpty") };
    }
    const provider = useSettingsStore.getState().activeProvider();
    if (!provider) {
      const error = getT()("chat.errNoProvider");
      set({ error });
      releaseOwnedOperation();
      return { ok: false, error };
    }
    if (!provider.model) {
      const error = getT()("chat.errNoModel", { provider: provider.name });
      set({ error });
      releaseOwnedOperation();
      return { ok: false, error };
    }

    const operation = ownedOperation ?? tryAcquireOperation();
    if (!operation) return { ok: false, error: getT()("chat.errBusy") };
    const sourceChatId = get().chatId;
    if (dirtySessions.has(sourceChatId)) {
      try {
        await flushDirtySession(sourceChatId);
        if (operation.controller.signal.aborted || get().chatId !== sourceChatId) {
          finishOperation(operation);
          return { ok: false, error: getT()("chat.errAborted") };
        }
        set({ error: null });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        set({ error });
        finishOperation(operation);
        return { ok: false, error };
      }
    }
    const sourceMessages = get().messages;
    const requestUser = buildRequestUserMessage(payload.requestText ?? payload.text, payload.mentions, payload.attachments);
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
    const controller = operation.controller;
    set({ status: "streaming", error: null });

    let accepted = false;
    const sourceChatTitle = get().chatTitle;
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
          updateAssistant((m) => {
            const pendingDeletes = m.pendingDeletes ?? (m.pendingDelete ? [m.pendingDelete] : []);
            return pendingDeletes.some((item) => item.id === e.id)
              ? m
              : { ...m, pendingDeletes: [...pendingDeletes, { id: e.id, title: e.title, status: "pending" }] };
          });
          break;
        case "error":
          updateAssistant((m) => ({ ...m, error: e.message }));
          break;
        case "done":
          updateAssistant((m) => (m.content ? m : { ...m, content: e.content }));
          break;
      }
    };

    let result: SendResult = { ok: true };
    try {
      const history = await buildRequestHistory(sourceMessages, controller.signal);
      if (controller.signal.aborted || activeOperation !== operation || get().chatId !== sourceChatId) {
        result = { ok: false, error: getT()("chat.errAborted") };
        return result;
      }
      const nextMessages = [...sourceMessages, userMsg, assistantMsg];
      set({ messages: nextMessages });
      accepted = true;
      onAccepted?.();

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
      const aborted = isAbortError(e) || controller.signal.aborted;
      if (!accepted) {
        const error = aborted ? getT()("chat.errAborted") : e instanceof Error ? e.message : String(e);
        result = { ok: false, error };
        if (!aborted) set({ error });
      } else if (!aborted) {
        const message = e instanceof Error ? e.message : String(e);
        updateAssistant((m) => ({ ...m, error: message }));
      }
    } finally {
      if (accepted) {
        const current = get();
        const sourceStateMessages = current.chatId === sourceChatId ? current.messages : [...sourceMessages, userMsg, assistantMsg];
        const title = sessionTitle(sourceStateMessages, sourceChatTitle);
        const session = buildChatSession(sourceStateMessages, sourceChatId, title);
        try {
          const meta = await saveSession(session);
          set((cur) => ({
            ...(cur.chatId === sourceChatId ? { chatTitle: title, error: null } : {}),
            sessions: [meta, ...cur.sessions.filter((x) => x.id !== meta.id)],
          }));
        } catch (e) {
          dirtySessions.set(sourceChatId, session);
          const error = e instanceof Error ? e.message : String(e);
          console.error("chat save failed", e);
          if (get().chatId === sourceChatId) set({ error });
        }
      }
      if (activeOperation === operation) set({ status: "idle" });
      finishOperation(operation);
    }
    return result;
  },

  retryLast: async () => {
    const { chatId, messages, status } = get();
    if (status === "streaming" || pendingNavigationVersion !== null || activeOperation || operationQueue.length > 0) return;
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx < 0) return;
    const msg = messages[lastUserIdx]!;
    const operation = tryAcquireOperation();
    if (!operation) return;
    const truncated = messages.slice(0, lastUserIdx);
    let installedTruncated = false;
    let resolved: ResolvedUserContext | null = null;
    set({ status: "streaming" });

    try {
      resolved = await resolveUserContext(msg, { signal: operation.controller.signal, refreshAttachments: true });
      const current = get();
      if (
        operation.controller.signal.aborted
        || activeOperation !== operation
        || current.chatId !== chatId
        || current.messages !== messages
      ) {
        resolved = null;
      } else {
        set({ messages: truncated });
        installedTruncated = true;
      }
    } catch (error) {
      if (!isAbortError(error) && get().chatId === chatId) set({ error: error instanceof Error ? error.message : String(error) });
    }

    if (!resolved || operation.controller.signal.aborted || get().chatId !== chatId || get().messages !== truncated) {
      if (activeOperation === operation) set({ status: "idle" });
      finishOperation(operation);
      return;
    }
    const res = await get().send({
      text: msg.content,
      requestText: withUnavailableContext(msg.content, resolved.unavailable),
      mentions: resolved.mentions,
      attachments: resolved.attachments,
    }, operation);
    if (!res.ok && installedTruncated && get().chatId === chatId && get().messages === truncated) set({ messages });
  },

  confirmDelete: async (noteId) => {
    if (!hasPendingDelete(get().messages, noteId)) return;
    await useNotesStore.getState().del(noteId);
    markDelete(set, noteId, "confirmed");
    await persistDeleteDecision(get, set);
    useUi.getState().pushToast({
      message: getT()("chat.toastNoteDeleted"),
      actionLabel: getT()("chat.toastUndo"),
      onAction: () => void useNotesStore.getState().undoDelete(),
    });
  },

  cancelDelete: async (noteId) => {
    if (!hasPendingDelete(get().messages, noteId)) return;
    markDelete(set, noteId, "cancelled");
    await persistDeleteDecision(get, set);
  },

  newChat: async () => {
    const version = beginNavigation();
    abortActiveOperation();
    const operation = await acquireOperation();
    try {
      if (version !== navigationVersion || !(await flushCurrentDirtySession(get, set))) return;
      if (version !== navigationVersion) return;
      set({ chatId: newId(), chatTitle: NEW_CHAT_TITLE, messages: [], status: "idle", error: null });
    } finally {
      finishOperation(operation);
      finishNavigation(version);
    }
  },

  loadChat: async (id) => {
    if (id === get().chatId && pendingNavigationVersion === null) return;
    const version = beginNavigation();
    abortActiveOperation();
    const operation = await acquireOperation();
    try {
      if (version !== navigationVersion || !(await flushCurrentDirtySession(get, set))) return;
      if (version !== navigationVersion) return;
      const session = await awaitWithAbort(api.chats.load(id), operation.controller.signal);
      if (version !== navigationVersion) return;
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
            ...(m.pendingDeletes?.length ? { pendingDeletes: m.pendingDeletes } : {}),
          })),
        status: "idle",
        error: null,
      });
    } catch (e) {
      if (version === navigationVersion) console.error("load chat failed", e);
    } finally {
      finishOperation(operation);
      finishNavigation(version);
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
    const operation = await acquireOperation();
    try {
      let session: ChatSessionDto;
      if (get().chatId === id) {
        session = buildChatSession(get().messages, id, clean);
      } else {
        session = dirtySessions.get(id) ?? await api.chats.load(id);
        session = { ...session, title: clean, updated: new Date().toISOString() };
      }
      const meta = await saveSession(session);
      set((s) => ({
        sessions: [meta, ...s.sessions.filter((x) => x.id !== id)],
        chatTitle: s.chatId === id ? clean : s.chatTitle,
        error: s.chatId === id ? null : s.error,
      }));
    } catch (e) {
      console.error("rename chat failed", e);
      if (get().chatId === id) set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      finishOperation(operation);
    }
  },

  deleteChat: async (id) => {
    if (get().chatId === id) abortActiveOperation();
    const operation = await acquireOperation();
    try {
      await api.chats.del(id);
      dirtySessions.delete(id);
      set((s) => {
        const deletingCurrent = s.chatId === id;
        return {
          sessions: s.sessions.filter((x) => x.id !== id),
          ...(deletingCurrent
            ? { chatId: newId(), chatTitle: NEW_CHAT_TITLE, messages: [], status: "idle" as const, error: null }
            : {}),
        };
      });
    } catch (e) {
      console.error("delete chat failed", e);
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      finishOperation(operation);
    }
  },

  stop: () => {
    activeOperation?.controller.abort();
  },
}));

function hasPendingDelete(messages: UiMessage[], noteId: string): boolean {
  return messages.some((m) =>
    m.pendingDeletes?.some((item) => item.id === noteId && item.status === "pending")
    || (m.pendingDelete?.id === noteId && m.pendingDelete.status === "pending"),
  );
}

async function persistDeleteDecision(get: () => ChatState, set: (state: Partial<ChatState>) => void): Promise<void> {
  const operation = await acquireOperation();
  try {
    const state = get();
    const session = buildChatSession(state.messages, state.chatId, state.chatTitle);
    try {
      const meta = await saveSession(session);
      set({ sessions: [meta, ...get().sessions.filter((item) => item.id !== meta.id)] });
    } catch (e) {
      dirtySessions.set(session.id, session);
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  } finally {
    finishOperation(operation);
  }
}

function markDelete(
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
  noteId: string,
  status: "confirmed" | "cancelled",
): void {
  set((s) => ({
    messages: s.messages.map((m) =>
      ({
        ...m,
        ...(m.pendingDelete?.id === noteId ? { pendingDelete: { ...m.pendingDelete, status } } : {}),
        ...(m.pendingDeletes?.some((item) => item.id === noteId)
          ? { pendingDeletes: m.pendingDeletes.map((item) => item.id === noteId ? { ...item, status } : item) }
          : {}),
      }),
    ),
  }));
}
