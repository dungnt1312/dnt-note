import { api, type NotePatchDto } from "../api/notes";
import type { ToolSchema } from "../llm/openai";
import { mediaApi } from "../api/media";
import { attachmentsApi } from "../api/attachments";
import { skillsApi } from "../api/skills";
import { MAX_DOC_CHARS, joinAttachmentPath } from "../media/paths";

export const MAX_ATTACHMENT_TEXT = MAX_DOC_CHARS;

/** Stored attachment names are flat; reject anything that could escape the dir. */
export function isSafeMediaName(name: string): boolean {
  return !!name && !["/", "\\", "..", "\0"].some((bad) => name.includes(bad));
}


export interface ToolArgs {
  id?: string;
  query?: string;
  title?: string;
  body?: string;
  tags?: string[];
  offset?: number;
  limit?: number;
  pinned?: boolean;
  name?: string;
}

/** Agent tools: 10 note tools (parity with NoteStudio) + media tools. */
export const AGENT_TOOLS: ToolSchema[] = [
  fn("list_notes", "Liệt kê ghi chú (mới nhất trước). Trả mảng meta không có body.", {
    type: "object",
    properties: {
      offset: { type: "integer", description: "Bỏ qua N ghi chú đầu" },
      limit: { type: "integer", description: "Số ghi chú trả về (mặc định 20, tối đa 50)" },
    },
  }),
  fn("search_notes", "Tìm ghi chú theo từ khóa (khớp tiêu đề + nội dung, không phân biệt hoa thường).", {
    type: "object",
    properties: {
      query: { type: "string", description: "Từ khóa tìm kiếm" },
      limit: { type: "integer", description: "Số kết quả (mặc định 10)" },
    },
    required: ["query"],
  }),
  fn("read_note", "Đọc nội dung đầy đủ của một ghi chú theo id.", {
    type: "object",
    properties: { id: { type: "string", description: "Id ghi chú" } },
    required: ["id"],
  }),
  fn("create_note", "Tạo ghi chú mới. Trả về note đã tạo kèm id.", {
    type: "object",
    properties: {
      title: { type: "string", description: "Tiêu đề" },
      body: { type: "string", description: "Nội dung markdown" },
      tags: { type: "array", items: { type: "string" }, description: "Danh sách tags" },
    },
    required: ["title"],
  }),
  fn("update_note", "Sửa ghi chú: tiêu đề, nội dung, tags hoặc pin. Chỉ gửi trường cần đổi.", {
    type: "object",
    properties: {
      id: { type: "string", description: "Id ghi chú cần sửa" },
      title: { type: "string" },
      body: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      pinned: { type: "boolean" },
    },
    required: ["id"],
  }),
  fn("delete_note", "YÊU CẦU xóa ghi chú. KHÔNG xóa ngay — hệ thống sẽ hiện thẻ xác nhận cho người dùng. Luôn thông báo cho người dùng rằng xóa cần xác nhận và có thể hoàn tác.", {
    type: "object",
    properties: { id: { type: "string", description: "Id ghi chú cần xóa" } },
    required: ["id"],
  }),
  fn("get_stats", "Thống kê tổng quan: số ghi chú, số đã ghim, số từ, số tags.", {
    type: "object",
    properties: {},
  }),
  fn("list_tags", "Liệt kê tất cả tags kèm số ghi chú dùng mỗi tag.", {
    type: "object",
    properties: {},
  }),
  fn("set_tags", "Gán lại toàn bộ tags của một ghi chú (thay thế danh sách cũ).", {
    type: "object",
    properties: {
      id: { type: "string", description: "Id ghi chú" },
      tags: { type: "array", items: { type: "string" }, description: "Danh sách tags mới" },
    },
    required: ["id", "tags"],
  }),
  fn("get_recent_notes", "Lấy N ghi chú cập nhật gần nhất (meta, không body).", {
    type: "object",
    properties: { limit: { type: "integer", description: "Mặc định 5" } },
  }),
  fn("list_media", "Liệt kê file trong thư viện phương tiện (ảnh, tài liệu, âm thanh) kèm ghi chú đang dùng.", {
    type: "object",
    properties: {},
  }),
  fn("read_attachment", "Đọc nội dung văn bản của một file đính kèm (pdf, docx, txt...) theo tên lưu trữ (trường name từ list_media).", {
    type: "object",
    properties: { name: { type: "string", description: "Tên file lưu trữ" } },
    required: ["name"],
  }),
  fn("load_skill", "Nạp hướng dẫn đầy đủ (SKILL.md) của một skill trong danh sách Skills khả dụng.", {
    type: "object",
    properties: { name: { type: "string", description: "Tên skill" } },
    required: ["name"],
  }),
];

function fn(name: string, description: string, parameters: Record<string, unknown>): ToolSchema {
  return { type: "function", function: { name, description, parameters } };
}

function slice(list: { id: string }[], offset = 0, limit = 20) {
  return list.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(Math.max(1, limit), 50));
}

/**
 * Execute a tool call from the model. Deletion is NEVER executed here — it
 * returns a pendingDelete payload that the UI turns into a confirmation card.
 */
export async function executeTool(name: string, args: ToolArgs): Promise<string> {
  try {
    switch (name) {
      case "list_notes":
      case "get_recent_notes": {
        const notes = await api.notes.list();
        return JSON.stringify(slice(notes, args.offset, args.limit ?? (name === "get_recent_notes" ? 5 : 20)));
      }
      case "search_notes":
        return JSON.stringify(await api.notes.search(args.query ?? "", args.limit ?? 10));
      case "read_note":
        return JSON.stringify(await api.notes.read(args.id ?? ""));
      case "create_note":
        return JSON.stringify(
          await api.notes.create(args.title ?? "Untitled", args.body ?? "", args.tags ?? []),
        );
      case "update_note": {
        const patch: NotePatchDto = {};
        if (args.title !== undefined) patch.title = args.title;
        if (args.body !== undefined) patch.body = args.body;
        if (args.tags !== undefined) patch.tags = args.tags;
        if (args.pinned !== undefined) patch.pinned = args.pinned;
        return JSON.stringify(await api.notes.update(args.id ?? "", patch));
      }
      case "delete_note": {
        const pending = args.id ?? "";
        const note = await api.notes.list().then((ns) => ns.find((n) => n.id === pending));
        return JSON.stringify({
          pendingDelete: pending,
          title: note?.title ?? pending,
          message: "Chờ người dùng xác nhận xóa trong thẻ xác nhận. Xóa xong có thể hoàn tác (Ctrl+Z).",
        });
      }
      case "get_stats":
        return JSON.stringify(await api.notes.stats());
      case "list_tags":
        return JSON.stringify(await api.notes.tags());
      case "set_tags":
        return JSON.stringify(await api.notes.update(args.id ?? "", { tags: args.tags ?? [] }));
      case "list_media": {
        const items = await mediaApi.list();
        return JSON.stringify(
          items.slice(0, 100).map((m) => ({
            name: m.name,
            displayName: m.displayName,
            kind: m.kind,
            size: m.size,
            usedBy: m.usedBy.map((u) => u.title),
          })),
        );
      }
      case "read_attachment": {
        const file = args.name ?? "";
        if (!isSafeMediaName(file)) return JSON.stringify({ error: "Tên file không hợp lệ" });
        const dir = await mediaApi.dirPath();
        const text = await attachmentsApi.extractText(joinAttachmentPath(dir, file));
        const truncated = text.length > MAX_ATTACHMENT_TEXT;
        return JSON.stringify({
          name: file,
          text: truncated ? text.slice(0, MAX_ATTACHMENT_TEXT) : text,
          truncated,
        });
      }
      case "load_skill": {
        const skillName = args.name ?? "";
        if (!/^[a-z0-9-]{1,64}$/.test(skillName)) return JSON.stringify({ error: "Tên skill không hợp lệ" });
        const skill = await skillsApi.read(skillName);
        if (!skill.enabled) return JSON.stringify({ error: `Skill "${skillName}" đang bị tắt` });
        return JSON.stringify({ name: skill.name, body: skill.body });
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
}
