import { streamChat } from "../llm/openai";
import type { AgentProviderConfig } from "./engine";

export interface Suggestion {
  title: string;
  tags: string[];
}

export interface SuggestOptions {
  provider: AgentProviderConfig;
  title: string;
  body: string;
  existingTags: string[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export const MAX_SUGGEST_BODY = 6000;
export const MAX_SUGGEST_TAGS = 5;
const INVALID = "Phản hồi gợi ý không hợp lệ — thử lại hoặc đổi mô hình.";

const SYSTEM_PROMPT = `Bạn là trợ lý đặt tiêu đề và thẻ cho ghi chú.
Đọc ghi chú và trả về DUY NHẤT một đối tượng JSON, không giải thích, dạng:
{"title": "...", "tags": ["..."]}
Quy tắc:
- title: ngắn gọn (tối đa ~80 ký tự), cùng ngôn ngữ với ghi chú.
- tags: tối đa ${MAX_SUGGEST_TAGS} thẻ, chữ thường, không có dấu '#', không khoảng trắng thừa.
- Ưu tiên dùng lại các thẻ đã có nếu phù hợp.`;

export function normalizeTags(tags: unknown[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const v = t.trim().replace(/^#+/, "").trim().toLowerCase();
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= MAX_SUGGEST_TAGS) break;
  }
  return out;
}

/** Tolerant parse: first {...} block, fenced or surrounded by prose. */
export function parseSuggestion(text: string): Suggestion {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const src = fenced?.[1] ?? text;
  const start = src.indexOf("{");
  if (start < 0) throw new Error(INVALID);
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error(INVALID);
  let obj: unknown;
  try {
    obj = JSON.parse(src.slice(start, end + 1));
  } catch {
    throw new Error(INVALID);
  }
  const o = obj as { title?: unknown; tags?: unknown };
  if (!o || typeof o.title !== "string" || !Array.isArray(o.tags)) throw new Error(INVALID);
  const title = o.title.trim();
  if (!title) throw new Error(INVALID);
  return { title, tags: normalizeTags(o.tags) };
}

export async function suggestTitleAndTags(opts: SuggestOptions): Promise<Suggestion> {
  const body = opts.body.length > MAX_SUGGEST_BODY ? opts.body.slice(0, MAX_SUGGEST_BODY) + "\n…" : opts.body;
  const user = [
    `Thẻ đã có: ${opts.existingTags.length ? opts.existingTags.join(", ") : "(chưa có)"}`,
    `Tiêu đề hiện tại: ${opts.title || "(chưa đặt)"}`,
    "Nội dung:",
    body,
  ].join("\n");
  const res = await streamChat({
    baseUrl: opts.provider.baseUrl,
    apiKey: opts.provider.apiKey,
    model: opts.provider.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
    signal: opts.signal,
    fetchImpl: opts.fetchImpl,
  });
  return parseSuggestion(res.content);
}
