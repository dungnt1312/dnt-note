import { describe, expect, it } from "vitest";
import { buildRequestUserMessage, buildUserContent, MAX_CONTEXT_CHARS, MAX_DOC_CHARS } from "./payload";
import type { AttachmentInput, MentionInput } from "./payload";

const m = (id: string, body: string, failed = false): MentionInput => ({ id, title: `T-${id}`, body, failed });

const doc = (over: Partial<AttachmentInput> = {}): AttachmentInput => ({
  id: "d",
  name: "d.pdf",
  originalName: "d.pdf",
  size: 1,
  kind: "document",
  text: "abc",
  ...over,
});

const img = (id: string): AttachmentInput => ({
  id,
  name: `${id}.png`,
  originalName: `${id}.png`,
  size: 1,
  kind: "image",
  previewUrl: `data:image/png;base64,${id}`,
});

describe("buildUserContent", () => {
  it("keeps plain text when no context", () => {
    expect(buildUserContent("hỏi", [], [])).toBe("hỏi");
  });

  it("appends mention blocks with title header", () => {
    const out = buildUserContent("hỏi", [m("n1", "nội dung")], []);
    expect(out).toBe("hỏi\n\n[@T-n1]\n---\nnội dung");
  });

  it("marks failed reads instead of sending empty body", () => {
    const out = buildUserContent("q", [m("n1", "", true)], []);
    expect(out).toContain("(không đọc được ghi chú)");
  });

  it("truncates one mention to MAX_CONTEXT_CHARS", () => {
    const out = buildUserContent("q", [m("n1", "x".repeat(10_000))], []);
    const block = out.split("---\n")[1]!;
    expect(block.length).toBe(MAX_CONTEXT_CHARS + 1); // body + ellipsis
    expect(out.endsWith("…")).toBe(true);
  });

  it("caps total hidden context at 48k and notes the omission", () => {
    const big = "x".repeat(10_000);
    const many = Array.from({ length: 8 }, (_, i) => m(`n${i}`, big));
    const out = buildUserContent("q", many, []);
    expect(out.length).toBeLessThan("q".length + 49_000);
    expect(out).toContain("đã lược bỏ");
  });

  it("appends document text blocks", () => {
    const out = buildUserContent("q", [], [doc()]);
    expect(out).toBe("q\n\n[File: d.pdf]\n---\nabc");
  });

  it("caps document text at MAX_DOC_CHARS", () => {
    const out = buildUserContent("q", [], [doc({ text: "y".repeat(MAX_DOC_CHARS + 500) })]);
    expect(out).toHaveLength("q".length + "\n\n[File: d.pdf]\n---\n".length + MAX_DOC_CHARS + 1);
  });
});

describe("buildRequestUserMessage", () => {
  it("keeps plain string content when no images", () => {
    const msg = buildRequestUserMessage("q", [], [doc()]);
    expect(msg.role).toBe("user");
    expect(msg.content).toBeTypeOf("string");
  });

  it("builds OpenAI parts when images present", () => {
    const msg = buildRequestUserMessage("q", [], [img("i1"), img("i2")]);
    expect(Array.isArray(msg.content)).toBe(true);
    const parts = msg.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts[0]).toEqual({ type: "text", text: "q" });
    const urls = parts.filter((p) => p.type === "image_url");
    expect(urls).toHaveLength(2);
    expect(urls[0].image_url?.url).toContain("i1");
    expect(urls[1].image_url?.url).toContain("i2");
  });
});
