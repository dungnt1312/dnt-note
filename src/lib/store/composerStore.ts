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

const newId = () => `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const ext = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const kindOf = (name: string): DraftAttachment["kind"] =>
  IMAGE_EXTENSIONS.includes(ext(name)) ? "image" : "document";

interface ComposerState {
  drafts: Record<string, ComposerDraft>;
  setEditorState: (chatId: string, editorJson: string | null, text: string) => void;
  addAttachmentFiles: (chatId: string, files: File[]) => Promise<void>;
  addAttachmentPaths: (chatId: string, paths: string[]) => Promise<void>;
  removeAttachment: (chatId: string, id: string) => void;
  clearDraft: (chatId: string) => void;
}

/** localStorage-safe view: no data URLs, no in-flight items, no empty drafts. */
export function stripForPersist(drafts: Record<string, ComposerDraft>): Record<string, ComposerDraft> {
  const out: Record<string, ComposerDraft> = {};
  for (const [chatId, d] of Object.entries(drafts)) {
    const attachments = d.attachments
      .filter((a) => a.status !== "importing")
      .map(({ previewUrl: _drop, ...rest }) => rest);
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

      const markError = (chatId: string, id: string, error: string) =>
        patch(chatId, (d) => ({
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
        patch(chatId, (d) => ({
          ...d,
          attachments: d.attachments.map((a) =>
            a.id === id ? { ...a, name: stored.name, size: stored.size, kind } : a,
          ),
        }));
        try {
          if (kind === "image") {
            const previewUrl = await attachmentsApi.prepareImage(stored.path);
            patch(chatId, (d) => ({
              ...d,
              attachments: d.attachments.map((a) => (a.id === id ? { ...a, status: "ready" as const, previewUrl } : a)),
            }));
          } else {
            const raw = await attachmentsApi.extractText(stored.path);
            patch(chatId, (d) => ({
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
        setEditorState: (chatId, editorJson, text) => patch(chatId, (d) => ({ ...d, editorJson, text })),

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
      };
    },
    {
      name: "dnt-composer-drafts",
      version: 1,
      partialize: (s) => ({ drafts: stripForPersist(s.drafts) }) as unknown as ComposerState,
    },
  ),
);
