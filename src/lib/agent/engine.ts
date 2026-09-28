import { streamChat, type ChatMessage, type ToolSchema } from "../llm/openai";
import { AGENT_TOOLS, executeTool } from "./tools";
import type { StatsDto } from "../api/notes";

export type AgentEvent =
  | { type: "delta"; content: string }
  | { type: "tool_start"; id: string; name: string; args: string }
  | { type: "tool_result"; id: string; name: string; result: string }
  | { type: "pending_delete"; id: string; title: string }
  | { type: "done"; content: string }
  | { type: "error"; message: string };

export interface AgentProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface RunAgentOptions {
  provider: AgentProviderConfig;
  messages: ChatMessage[];
  systemPrompt: string;
  maxIterations?: number;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentRunResult {
  content: string;
  /** Full conversation including assistant/tool messages produced this run. */
  messages: ChatMessage[];
  /** Ids from delete_note tool calls awaiting user confirmation. */
  pendingDeletes: { id: string; title: string }[];
}

export const MAX_AGENT_ITERATIONS = 12;

export function buildSystemPrompt(
  stats: StatsDto,
  currentNoteId: string | null,
  currentNoteTitle: string | null,
  skills: { name: string; description: string }[] = [],
): string {
  const current = currentNoteId
    ? `Ghi chú đang mở: "${currentNoteTitle}" (id: ${currentNoteId}).`
    : "Không có ghi chú nào đang mở.";
  const lines = [
    "Bạn là trợ lý AI bên trong ứng dụng ghi chú DNT Note. Bạn có thể trực tiếp thao tác với ghi chú của người dùng qua các tool được cung cấp.",
    `Thống kê hiện tại: ${stats.total} ghi chú, ${stats.pinned} đã ghim, ${stats.tags} tags.`,
    current,
    "Nguyên tắc:",
    "- Khi người dùng yêu cầu thao tác (tạo/sửa/tìm/xóa/đếm), hãy DÙNG tool, không tự bịa dữ liệu.",
    "- delete_note KHÔNG xóa ngay: hệ thống sẽ hiện thẻ xác nhận cho người dùng. Hãy nói rõ điều đó.",
    "- Khi nhắc đến một ghi chú cụ thể (kết quả tìm kiếm, ghi chú vừa tạo/sửa/đọc), hãy bọc tên ghi chú trong link để người dùng bấm mở trực tiếp: [Tên ghi chú](note://<id>) — thay <id> bằng id thật từ kết quả tool.",
    "- Trả lời bằng markdown ngắn gọn, tiếng Việt theo ngôn ngữ của người dùng.",
    "- Khi tạo/sửa ghi chú, dùng markdown có cấu trúc (heading, list).",
  ];
  if (skills.length) {
    lines.push("Skills khả dụng (gọi load_skill để nạp hướng dẫn đầy đủ trước khi làm theo):");
    for (const sk of skills) lines.push(`- ${sk.name}: ${sk.description}`);
  }
  return lines.join("\n");
}

/** Core agent loop: stream → (tool calls → execute → append result → repeat). */
export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const { provider, systemPrompt, signal, onEvent } = options;
  const maxIterations = options.maxIterations ?? MAX_AGENT_ITERATIONS;

  const conversation: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...options.messages,
  ];
  const pendingDeletes: AgentRunResult["pendingDeletes"] = [];
  let finalContent = "";

  for (let i = 0; i < maxIterations; i++) {
    let assistantMessage: ChatMessage | null = null;
    try {
      const result = await streamChat({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        messages: conversation,
        tools: AGENT_TOOLS as ToolSchema[],
        signal,
        onDelta: (d) => {
          if (d.content) {
            finalContent += d.content;
            onEvent?.({ type: "delta", content: d.content });
          }
        },
      });

      assistantMessage = {
        role: "assistant",
        content: result.content || null,
        ...(result.toolCalls.length > 0 ? { tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })) } : {}),
      };
      conversation.push(assistantMessage);

      if (result.toolCalls.length === 0) {
        onEvent?.({ type: "done", content: result.content });
        return { content: result.content, messages: conversation, pendingDeletes };
      }

      for (const call of result.toolCalls) {
        onEvent?.({ type: "tool_start", id: call.id, name: call.name, args: call.arguments });
        let parsed: Parameters<typeof executeTool>[1] = {};
        try {
          parsed = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          // malformed arguments — let the tool surface the error
        }
        const result = await executeTool(call.name, parsed);
        onEvent?.({ type: "tool_result", id: call.id, name: call.name, result });
        try {
          const payload = JSON.parse(result) as { pendingDelete?: string; title?: string };
          if (payload.pendingDelete) {
            pendingDeletes.push({ id: payload.pendingDelete, title: payload.title ?? payload.pendingDelete });
            onEvent?.({ type: "pending_delete", id: payload.pendingDelete, title: payload.title ?? "" });
          }
        } catch {
          // non-JSON tool result — nothing pending
        }
        conversation.push({
          role: "tool",
          content: result,
          tool_call_id: call.id,
          name: call.name,
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      onEvent?.({ type: "error", message });
      return { content: finalContent, messages: conversation, pendingDeletes };
    }
  }

  onEvent?.({ type: "done", content: finalContent });
  return { content: finalContent, messages: conversation, pendingDeletes };
}
