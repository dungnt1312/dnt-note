import { describe, it, expect, vi } from "vitest";
import { parseSuggestion, suggestTitleAndTags, MAX_SUGGEST_BODY } from "./suggest";

function sseFetch(text: string) {
  const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  return vi.fn(async () => new Response(payload, { status: 200 })) as unknown as typeof fetch;
}

const provider = { baseUrl: "http://x", model: "m" };

describe("parseSuggestion", () => {
  it("parses fenced JSON", () => {
    const r = parseSuggestion('Đây:\n```json\n{"title":"Họp","tags":["#Work"," work ","Ý tưởng"]}\n```');
    expect(r).toEqual({ title: "Họp", tags: ["work", "ý tưởng"] });
  });

  it("ignores trailing text and braces inside strings", () => {
    const r = parseSuggestion('{"title":"a {b}","tags":["x"]} và vài dòng thêm }');
    expect(r).toEqual({ title: "a {b}", tags: ["x"] });
  });

  it("caps tags at 5", () => {
    const r = parseSuggestion('{"title":"t","tags":["a","b","c","d","e","f"]}');
    expect(r.tags).toHaveLength(5);
  });

  it("throws on bad JSON or wrong types", () => {
    expect(() => parseSuggestion("không có json")).toThrow(/không hợp lệ/);
    expect(() => parseSuggestion('{"title": "x", tags: }')).toThrow(/không hợp lệ/);
    expect(() => parseSuggestion('{"title": 1, "tags": []}')).toThrow(/không hợp lệ/);
  });
});

describe("suggestTitleAndTags", () => {
  it("calls the provider without tools and parses the reply", async () => {
    const fetchImpl = sseFetch('{"title":"Kế hoạch","tags":["plan"]}');
    const r = await suggestTitleAndTags({
      provider,
      title: "",
      body: "x".repeat(MAX_SUGGEST_BODY + 500),
      existingTags: ["plan"],
      fetchImpl,
    });
    expect(r).toEqual({ title: "Kế hoạch", tags: ["plan"] });
    const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1];
    const sent = JSON.parse(init.body as string);
    expect(sent.tools).toBeUndefined();
    expect(sent.messages[1].content.length).toBeLessThan(MAX_SUGGEST_BODY + 200);
    expect(sent.messages[1].content).toContain("plan");
  });

  it("throws Vietnamese error on invalid reply", async () => {
    await expect(
      suggestTitleAndTags({ provider, title: "", body: "b", existingTags: [], fetchImpl: sseFetch("xin lỗi") }),
    ).rejects.toThrow(/không hợp lệ/);
  });
});
