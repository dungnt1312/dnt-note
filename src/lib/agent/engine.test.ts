import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatMessage } from "../llm/openai";

vi.mock("../llm/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../llm/openai")>();
  return { ...actual, streamChat: vi.fn() };
});
vi.mock("./tools", () => ({
  AGENT_TOOLS: [{ type: "function", function: { name: "read_note", description: "d", parameters: {} } }],
  executeTool: vi.fn(async (_name: string, args: { id?: string }) =>
    JSON.stringify({ id: args.id, body: "note body" })),
}));

import { streamChat } from "../llm/openai";
import { executeTool } from "./tools";
import { runAgent, buildSystemPrompt } from "./engine";

const streamChatMock = vi.mocked(streamChat);
const executeToolMock = vi.mocked(executeTool);

beforeEach(() => {
  streamChatMock.mockClear();
  executeToolMock.mockClear();
});

const baseOpts = {
  provider: { baseUrl: "http://x", apiKey: "k", model: "m" },
};

describe("buildSystemPrompt", () => {
  it("includes stats and rules", () => {
    const p = buildSystemPrompt({ total: 12, pinned: 2, words: 99, tags: 3 }, "n1", "Đang đọc");
    expect(p).toContain("12");
    expect(p).toContain("n1");
    expect(p).toContain("Đang đọc");
    expect(p.toLowerCase()).toContain("xác nhận");
  });

  it("instructs the model to link notes so the user can open them", () => {
    const p = buildSystemPrompt({ total: 1, pinned: 0, words: 0, tags: 0 }, null, null);
    expect(p).toContain("note://");
  });
});

describe("buildSystemPrompt skills", () => {
  const stats = { total: 1, pinned: 0, words: 0, tags: 0 };
  it("omits the skills section when empty", () => {
    expect(buildSystemPrompt(stats, null, null)).not.toContain("Skills khả dụng");
  });
  it("lists skills and instructs load_skill", () => {
    const p = buildSystemPrompt(stats, null, null, [{ name: "tom-tat", description: "Tóm tắt" }]);
    expect(p).toContain("Skills khả dụng");
    expect(p).toContain("load_skill");
    expect(p).toContain("- tom-tat: Tóm tắt");
  });
});

describe("runAgent", () => {
  it("loops: stream → tool call → tool result → final text", async () => {
    streamChatMock
      .mockImplementationOnce(async ({ onDelta }) => {
        onDelta?.({ content: "", toolCalls: [{ index: 0, id: "c1", name: "read_note", args: '{"id":"n1"}' }] });
        return { content: "", toolCalls: [{ id: "c1", name: "read_note", arguments: '{"id":"n1"}' }] };
      })
      .mockImplementationOnce(async ({ onDelta }) => {
        onDelta?.({ content: "Ghi chú nói về: ", toolCalls: [] });
        onDelta?.({ content: "note body", toolCalls: [] });
        return { content: "Ghi chú nói về: note body", toolCalls: [] };
      });

    const events: string[] = [];
    const result = await runAgent({
      ...baseOpts,
      messages: [{ role: "user", content: "đọc note n1" } as ChatMessage],
      systemPrompt: buildSystemPrompt({ total: 1, pinned: 0, words: 0, tags: 0 }, null, null),
      onEvent: (e) => events.push(e.type),
    });

    expect(result.content).toBe("Ghi chú nói về: note body");
    expect(result.messages).toHaveLength(5); // system, user, assistant(toolcall), tool, assistant(final)
    expect(executeToolMock).toHaveBeenCalledWith("read_note", { id: "n1" });
    expect(events.filter((e) => e !== "delta")).toEqual(["tool_start", "tool_result", "done"]);
    // Second stream call receives the tool result message (array is live — check presence, not tail)
    const secondCallMessages = streamChatMock.mock.calls[1][0].messages;
    expect(secondCallMessages.some((m) => m.role === "tool" && m.tool_call_id === "c1")).toBe(true);
  });

  it("stops after maxIterations", async () => {
    streamChatMock.mockImplementation(async ({ onDelta }) => {
      onDelta?.({ content: "", toolCalls: [{ index: 0, id: "x", name: "get_stats", args: "{}" }] });
      return { content: "", toolCalls: [{ id: "x", name: "get_stats", arguments: "{}" }] };
    });
    const events: string[] = [];
    const result = await runAgent({
      ...baseOpts,
      messages: [{ role: "user", content: "loop" } as ChatMessage],
      systemPrompt: "sys",
      maxIterations: 3,
      onEvent: (e) => events.push(e.type),
    });
    expect(streamChatMock).toHaveBeenCalledTimes(3);
    expect(result.content).toBe("");
    expect(events.filter((e) => e === "tool_start")).toHaveLength(3);
  });

  it("propagates abort signal", async () => {
    streamChatMock.mockImplementation(async ({ signal }) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return { content: "ok", toolCalls: [] };
    });
    const controller = new AbortController();
    const result = await runAgent({
      ...baseOpts,
      messages: [{ role: "user", content: "hi" } as ChatMessage],
      systemPrompt: "sys",
      signal: controller.signal,
    });
    expect(result.content).toBe("ok");
  });
});
