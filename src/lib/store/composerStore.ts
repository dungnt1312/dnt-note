import { create } from "zustand";
import { persist } from "zustand/middleware";
import { attachmentsApi } from "../api/attachments";
import { MAX_DOC_CHARS } from "../chat/payload";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

export interface DraftAttachment {
  id: string;
  /** Stored (uuid-prefixed) name inside attachments/; empty while importing. */
  name: string;
  originalName: string;
  size: number;
  kind: "image" | "document";
  status: "importing" | "ready" | "error";
  error?: string;
  text?: string;
  previewUrl?: string;
}

export interface ComposerDraft {
  editorJson: string | null;
  text: string;
  attachments: DraftAttachment[];
}

/** One-shot handoff from the note editor's right-click menu to the composer. */
export type PendingChatContext =
  | { kind: "snippet"; title: string; text: string }
  | { kind: "note"; noteId: string; title: string };

const newId = () => `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const ext = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const kindOf = (name: string): DraftAttachment["kind"] =>
  IMAGE_EXTENSIONS.includes(ext(name)) ? "image" : "document";
export const clipCodePoints = (text: string, max: number) => Array.from(text).slice(0, max).join("");

export interface SentDraftSnapshot {
  editorJson: string | null;
  text: string;
  attachmentIds: string[];
}

interface ComposerState {
  drafts: Record<string, ComposerDraft>;
  pendingContext: PendingChatContext | null;
  setEditorState: (chatId: string, editorJson: string | null, text: string) => void;
  addAttachmentFiles: (chatId: string, files: File[]) => Promise<void>;
  addAttachmentPaths: (chatId: string, paths: string[]) => Promise<void>;
  removeAttachment: (chatId: string, id: string) => void;
  clearDraft: (chatId: string) => void;
  consumeSentDraft: (chatId: string, snapshot: SentDraftSnapshot) => void;
  restoreDraftAttachments: (chatId: string) => Promise<void>;
  addSnippet: (chatId: string, snippet: { originalName: string; text: string }) => Promise<void>;
  pushChatContext: (ctx: PendingChatContext) => void;
  takeChatContext: () => PendingChatContext | null;
}

/** localStorage-safe view: no data URLs, no in-flight items, no empty drafts. */
export function stripForPersist(drafts: Record<string, ComposerDraft>): Record<string, ComposerDraft> {
  const out: Record<string, ComposerDraft> = {};
  for (const [chatId, d] of Object.entries(drafts)) {
    const attachments = d.attachments
      .filter((a) => a.status !== "importing")
      .map(({ previewUrl: _previewUrl, text, ...rest }) =>
        rest.name ? rest : { ...rest, ...(text !== undefined ? { text } : {}) },
      );
    if (!d.text && !d.editorJson && attachments.length === 0) continue;
    out[chatId] = { editorJson: d.editorJson, text: d.text, attachments };
  }
  return out;
}

export const useComposerStore = create<ComposerState>()(
  persist(
      (set, get) => {
        const EMPTY = (): ComposerDraft => ({ editorJson: null, text: "", attachments: [] });
      const patch = (chatId: string, fn: (d: ComposerDraft) => ComposerDraft) =>
        set((s) => ({ drafts: { ...s.drafts, [chatId]: fn(s.drafts[chatId] ?? EMPTY()) } }));
      const patchExisting = (chatId: string, fn: (d: ComposerDraft) => ComposerDraft) =>
        set((s) => {
          const current = s.drafts[chatId];
          return current ? { drafts: { ...s.drafts, [chatId]: fn(current) } } : s;
        });

      const markError = (chatId: string, id: string, error: string) =>
        patchExisting(chatId, (d) => ({
          ...d,
          attachments: d.attachments.map((a) => (a.id === id ? { ...a, status: "error" as const, error } : a)),
        }));

      /** Fill name/size/kind and prepare the preview or extracted text. */
      const hydrate = async (
        chatId: string,
        id: string,
        stored: { name: string; size: number; path: string },
        originalName: string,
      ) => {
        const kind = kindOf(originalName);
        // The file is on disk now — keep its identity even if prepare/extract fails.
        patchExisting(chatId, (d) => ({
          ...d,
          attachments: d.attachments.map((a) =>
            a.id === id ? { ...a, name: stored.name, size: stored.size, kind } : a,
          ),
        }));
        try {
          if (kind === "image") {
            const previewUrl = await attachmentsApi.prepareImage(stored.path);
            patchExisting(chatId, (d) => ({
              ...d,
              attachments: d.attachments.map((a) => (a.id === id ? { ...a, status: "ready" as const, previewUrl } : a)),
            }));
          } else {
            const raw = await attachmentsApi.extractText(stored.path);
            patchExisting(chatId, (d) => ({
              ...d,
              attachments: d.attachments.map((a) =>
                a.id === id ? { ...a, status: "ready" as const, text: raw.slice(0, MAX_DOC_CHARS) } : a,
              ),
            }));
          }
        } catch (e) {
          markError(chatId, id, e instanceof Error ? e.message : String(e));
        }
      };

      const importPaths = async (chatId: string, named: { path: string; originalName: string }[]) => {
        for (const { path, originalName } of named) {
          const id = newId();
          patch(chatId, (d) => ({
            ...d,
            attachments: [
              ...d.attachments,
              { id, name: "", originalName, size: 0, kind: kindOf(originalName), status: "importing" as const },
            ],
          }));
          try {
            const stored = await attachmentsApi.importFile(path);
            await hydrate(chatId, id, stored, originalName);
          } catch (e) {
            markError(chatId, id, e instanceof Error ? e.message : String(e));
          }
        }
      };

      return {
        drafts: {},
        pendingContext: null,
        setEditorState: (chatId, editorJson, text) => {
          const current = get().drafts[chatId];
          if (!current && !text) return;
          patch(chatId, (d) => ({ ...d, editorJson, text }));
        },

        restoreDraftAttachments: async (chatId) => {
          const attachments = get().drafts[chatId]?.attachments ?? [];
          for (const attachment of attachments) {
            if (attachment.status !== "ready") continue;
            if (!attachment.name) {
              if (attachment.kind === "document" && attachment.text !== undefined) {
                await get().addSnippet(chatId, { originalName: attachment.originalName, text: attachment.text });
              }
              continue;
            }
            if (attachment.kind === "image" && !attachment.previewUrl) {
              try {
                const previewUrl = await attachmentsApi.prepareImage(attachment.name);
                patchExisting(chatId, (d) => ({
                  ...d,
                  attachments: d.attachments.map((a) => a.id === attachment.id ? { ...a, previewUrl } : a),
                }));
              } catch (e) {
                markError(chatId, attachment.id, e instanceof Error ? e.message : String(e));
              }
            } else if (attachment.kind === "document" && attachment.text === undefined) {
              try {
                const text = clipCodePoints(await attachmentsApi.extractText(attachment.name), MAX_DOC_CHARS);
                patchExisting(chatId, (d) => ({
                  ...d,
                  attachments: d.attachments.map((a) => a.id === attachment.id ? { ...a, text } : a),
                }));
              } catch (e) {
                markError(chatId, attachment.id, e instanceof Error ? e.message : String(e));
              }
            }
          }
        },

        addSnippet: async (chatId, { originalName, text }) => {
          const clipped = clipCodePoints(text, MAX_DOC_CHARS);
          const legacy = get().drafts[chatId]?.attachments.find(
            (a) => a.status === "ready" && !a.name && a.originalName === originalName && a.text === clipped,
          );
          const duplicate = get().drafts[chatId]?.attachments.some(
            (a) =>
              (a.status === "importing" || (a.status === "ready" && Boolean(a.name)))
              && a.originalName === originalName
              && a.text === clipped,
          );
          if (duplicate) return;

          const id = legacy?.id ?? newId();
          const importing: DraftAttachment = {
            id,
            name: "",
            originalName,
            size: new TextEncoder().encode(clipped).length,
            kind: "document",
            status: "importing",
            text: clipped,
          };
          patch(chatId, (d) => ({
            ...d,
            attachments: legacy
              ? d.attachments.map((a) => a.id === legacy.id ? importing : a)
              : [...d.attachments, importing],
          }));
          try {
            const bytes = new TextEncoder().encode(clipped);
            const stored = await attachmentsApi.importBytes("chat-snippet.md", bytes);
            patchExisting(chatId, (d) => ({
              ...d,
              attachments: d.attachments.map((a) =>
                a.id === id
                  ? { ...a, name: stored.name, size: stored.size, status: "ready" as const }
                  : a,
              ),
            }));
          } catch (e) {
            markError(chatId, id, e instanceof Error ? e.message : String(e));
          }
        },

        pushChatContext: (ctx) => set({ pendingContext: ctx }),
        takeChatContext: () => {
          const ctx = get().pendingContext;
          if (ctx) set({ pendingContext: null });
          return ctx;
        },

        addAttachmentFiles: async (chatId, files) => {
          for (const file of files) {
            const id = newId();
            patch(chatId, (d) => ({
              ...d,
              attachments: [
                ...d.attachments,
                { id, name: "", originalName: file.name, size: file.size, kind: kindOf(file.name), status: "importing" as const },
              ],
            }));
            try {
              const bytes = new Uint8Array(await file.arrayBuffer());
              const stored = await attachmentsApi.importBytes(file.name, bytes);
              await hydrate(chatId, id, stored, file.name);
            } catch (e) {
              markError(chatId, id, e instanceof Error ? e.message : String(e));
            }
          }
        },

        addAttachmentPaths: (chatId, paths) =>
          importPaths(
            chatId,
            paths.map((p) => ({ path: p, originalName: p.split(/[\\/]/).pop() ?? p })),
          ),

        removeAttachment: (chatId, id) =>
          patch(chatId, (d) => ({ ...d, attachments: d.attachments.filter((a) => a.id !== id) })),

        clearDraft: (chatId) =>
          set((s) => {
            const { [chatId]: _gone, ...rest } = s.drafts;
            return { drafts: rest };
          }),

        consumeSentDraft: (chatId, snapshot) =>
          set((s) => {
            const current = s.drafts[chatId];
            if (!current) return s;
            const sentIds = new Set(snapshot.attachmentIds);
            const sameEditor = current.editorJson === snapshot.editorJson && current.text === snapshot.text;
            const next: ComposerDraft = {
              editorJson: sameEditor ? null : current.editorJson,
              text: sameEditor ? "" : current.text,
              attachments: current.attachments.filter((a) => !sentIds.has(a.id)),
            };
            if (!next.text && !next.editorJson && next.attachments.length === 0) {
              const { [chatId]: _gone, ...rest } = s.drafts;
              return { drafts: rest };
            }
            return { drafts: { ...s.drafts, [chatId]: next } };
          }),
      };
    },
    {
      name: "dnt-composer-drafts",
      version: 1,
      partialize: (s) => ({ drafts: stripForPersist(s.drafts) }) as unknown as ComposerState,
    },
  ),
);
