import { describe, it, expect } from "vitest";
import { parseSseChunk, extractToolCallDelta, type StreamDelta } from "./openai";

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
  it("merges tool call argument fragments by index", () => {
    const calls: Record<number, StreamDelta["toolCalls"][number]> = {};
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
    const calls: Record<number, StreamDelta["toolCalls"][number]> = {};
    extractToolCallDelta(calls, { index: 0, id: "a", name: "list_notes", args: "{}" });
    extractToolCallDelta(calls, { index: 1, id: "b", name: "get_stats", args: "" });
    expect(Object.keys(calls).length).toBe(2);
    expect(calls[1]?.name).toBe("get_stats");
  });
});
