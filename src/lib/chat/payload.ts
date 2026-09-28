import type { ChatMessage, ContentPart } from "../llm/openai";

export const MAX_CONTEXT_CHARS = 8000;
export const MAX_DOC_CHARS = 20000;
export const MAX_TOTAL_CONTEXT_CHARS = 48000;

export interface MentionInput {
  id: string;
  title: string;
  body: string;
  /** Note body could not be re-read — warn instead of sending empty context. */
  failed?: boolean;
}

export interface AttachmentInput {
  id: string;
  /** Stored (uuid-prefixed) name inside the attachments dir. */
  name: string;
  originalName: string;
  size: number;
  kind: "image" | "document";
  /** Extracted text for documents (≤ MAX_DOC_CHARS). */
  text?: string;
  /** Data URL for images (transient — never persisted). */
  previewUrl?: string;
}

function clip(text: string, max: number, budget: number): { body: string; truncated: boolean } {
  const limit = Math.min(max, Math.max(0, budget));
  const codePoints = Array.from(text);
  return { body: codePoints.slice(0, limit).join(""), truncated: codePoints.length > limit };
}

/** Visible text + hidden context blocks (mentions and document extracts). */
export function buildUserContent(text: string, mentions: MentionInput[], docs: AttachmentInput[]): string {
  let out = text;
  let budget = MAX_TOTAL_CONTEXT_CHARS;
  let overran = false;
  const block = (header: string, body: string) => `\n\n${header}\n---\n${body}`;
  for (const m of mentions) {
    const header = `[@${m.title}]`;
    if (m.failed) {
      out += block(header, "(không đọc được ghi chú)");
      continue;
    }
    const { body, truncated } = clip(m.body, MAX_CONTEXT_CHARS, budget);
    budget -= body.length;
    if (budget <= 0) overran = true;
    out += block(header, truncated ? `${body}…` : body || "(trống)");
  }
  for (const d of docs) {
    const header = `[File: ${d.originalName}]`;
    const { body, truncated } = clip(d.text ?? "", MAX_DOC_CHARS, budget);
    budget -= body.length;
    if (budget <= 0) overran = true;
    out += block(header, body ? (truncated ? `${body}…` : body) : "(không đọc được nội dung file)");
  }
  if (overran) out += "\n\n(một phần ngữ cảnh đã lược bỏ do vượt giới hạn)";
  return out;
}

/** Wire user message: plain string, or OpenAI content parts when images are attached. */
export function buildRequestUserMessage(
  text: string,
  mentions: MentionInput[],
  attachments: AttachmentInput[],
): ChatMessage {
  const docs = attachments.filter((a) => a.kind === "document" && a.text);
  const content = buildUserContent(text, mentions, docs);
  const images = attachments.filter((a) => a.kind === "image" && a.previewUrl);
  if (images.length === 0) return { role: "user", content };
  const parts: ContentPart[] = [
    { type: "text", text: content },
    ...images.map((a) => ({ type: "image_url" as const, image_url: { url: a.previewUrl! } })),
  ];
  return { role: "user", content: parts };
}
