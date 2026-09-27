import { describe, it, expect, vi } from "vitest";
import { parseSseChunk, extractToolCallDelta, embed, transcribe } from "./openai";

describe("parseSseChunk", () => {
  it("parses complete data events and returns remainder", () => {
    const input = 'data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c":';
    const { deltas, rest } = parseSseChunk(input);
    expect(deltas).toEqual([{ a: 1 }, { b: 2 }]);
    expect(rest).toBe("data: {\"c\":");
  });

  it("skips [DONE] and comments", () => {
    const input = 'data: [DONE]\n\n: keepalive\n\ndata: {"x":9}\n\n';
    const { deltas, rest } = parseSseChunk(input);
    expect(deltas).toEqual([{ x: 9 }]);
    expect(rest).toBe("");
  });

  it("handles CRLF separators", () => {
    const { deltas } = parseSseChunk('data: {"k":1}\r\n\r\ndata: {"k":2}\r\n\r\n');
    expect(deltas).toEqual([{ k: 1 }, { k: 2 }]);
  });

  it("returns empty for incomplete chunk", () => {
    const { deltas, rest } = parseSseChunk('data: {"par');
    expect(deltas).toEqual([]);
    expect(rest).toBe('data: {"par');
  });
});

describe("extractToolCallDelta", () => {
  type MergedCall = { id: string; name: string; arguments: string };
  it("merges tool call argument fragments by index", () => {
    const calls: Record<number, MergedCall> = {};
    const frags = [
      { index: 0, id: "call_1", name: "read_note", args: '{"id":' },
      { index: 0, id: undefined, name: undefined, args: '"n1"}' },
    ];
    for (const f of frags) {
      extractToolCallDelta(calls, f);
    }
    expect(calls[0]).toEqual({ id: "call_1", name: "read_note", arguments: '{"id":"n1"}' });
  });

  it("tracks two parallel tool calls", () => {
    const calls: Record<number, MergedCall> = {};
    extractToolCallDelta(calls, { index: 0, id: "a", name: "list_notes", args: "{}" });
    extractToolCallDelta(calls, { index: 1, id: "b", name: "get_stats", args: "" });
    expect(Object.keys(calls).length).toBe(2);
    expect(calls[1]?.name).toBe("get_stats");
  });
});

describe("embed", () => {
  it("posts to /embeddings and sorts by index", async () => {
    const f = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }] }), { status: 200 }),
    );
    const out = await embed({ baseUrl: "http://h", model: "e", inputs: ["a", "b"], fetchImpl: f as unknown as typeof fetch });
    expect(out).toEqual([[1], [2]]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://h/v1/embeddings");
    expect(JSON.parse(init.body as string)).toEqual({ model: "e", input: ["a", "b"] });
  });
  it("throws LLM status on error", async () => {
    const f = vi.fn(async () => new Response("bad", { status: 401 }));
    await expect(embed({ baseUrl: "http://h", model: "e", inputs: ["a"], fetchImpl: f as unknown as typeof fetch })).rejects.toThrow("LLM 401: bad");
  });
});

describe("transcribe", () => {
  it("posts multipart form to /audio/transcriptions", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ text: "xin chào" }), { status: 200 }));
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const out = await transcribe({
      baseUrl: "http://h/v1", apiKey: "k", model: "whisper-1", audio, fileName: "a.webm", language: "vi",
      fetchImpl: f as unknown as typeof fetch,
    });
    expect(out).toBe("xin chào");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://h/v1/audio/transcriptions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    const fd = init.body as FormData;
    expect(fd.get("model")).toBe("whisper-1");
    expect(fd.get("language")).toBe("vi");
    expect(fd.get("response_format")).toBe("json");
    const file = fd.get("file") as File;
    expect(file.name).toBe("a.webm");
    expect(file.size).toBe(3);
  });
  it("omits language when absent and throws on error", async () => {
    const f = vi.fn(async () => new Response("nope", { status: 400 }));
    await expect(
      transcribe({ baseUrl: "http://h", model: "m", audio: new Blob([]), fileName: "x.webm", fetchImpl: f as unknown as typeof fetch }),
    ).rejects.toThrow("LLM 400: nope");
    const fd = (f.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(fd.has("language")).toBe(false);
  });
});
