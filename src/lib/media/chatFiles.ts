import { mediaApi } from "../api/media";
import { attachmentsApi } from "../api/attachments";
import type { ChatFileInput } from "../store/chatStore";
import { MAX_DOC_CHARS, joinAttachmentPath } from "./paths";
import { AUDIO_EXTS } from "./extensions";
import { fileToBase64 } from "./insertLink";

export const MAX_CHAT_FILES = 5;
export const CHAT_AUDIO_UNSUPPORTED = "Chưa hỗ trợ âm thanh trong trò chuyện";
const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function chatKindOf(name: string): "image" | "document" | "audio" {
  const ext = extOf(name);
  if (IMAGE_EXTS.includes(ext)) return "image";
  if (AUDIO_EXTS.includes(ext)) return "audio";
  return "document";
}

/** Load a stored library file as chat input (image data URL or extracted text). */
export async function prepareStored(name: string): Promise<ChatFileInput> {
  const full = joinAttachmentPath(await mediaApi.dirPath(), name);
  if (chatKindOf(name) === "image") {
    return { name, kind: "image", dataUrl: await attachmentsApi.prepareImage(full) };
  }
  const text = await attachmentsApi.extractText(full);
  return { name, kind: "document", text: text.slice(0, MAX_DOC_CHARS) };
}

export async function prepareFromPath(path: string): Promise<ChatFileInput> {
  const stored = await mediaApi.import(path);
  return prepareStored(stored.name);
}

export async function prepareFromBlob(file: File): Promise<ChatFileInput> {
  const stored = await mediaApi.importBytes(file.name || "pasted.png", await fileToBase64(file));
  return prepareStored(stored.name);
}

/** Strip the uuid prefix added by the library store. */
export function displayName(stored: string): string {
  return stored.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
}
