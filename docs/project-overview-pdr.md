# DNT Note — Tổng quan dự án & PDR (Product Development Requirements)

> Cập nhật: 2026-09-27 · Version **0.1.0** · Trạng thái: khả dụng cho Windows, đang phát triển Phase 5–7
> Tài liệu liên quan: [codebase-summary](./codebase-summary.md) · [system-architecture](./system-architecture.md) · [project-roadmap](./project-roadmap.md)

## 1. Vấn đề cần giải quyết

- Người dùng ghi chú cá nhân bị khóa vào app đóng: dữ liệu nằm trong database riêng tư
  (Notion, Obsidian vault có nhưng thiếu AI agent; các app AI gửi dữ liệu lên cloud).
- Trợ lý AI cho ghi chú thường chỉ là "chat dán text": không thao tác được trực tiếp với ghi chú
  (tạo / sửa / tìm / xóa) và không kết nối được với AI client bên ngoài.
- Sync giữa máy tính thường phải qua dịch vụ độc quyền; khó dùng chính OneDrive/Google Drive
  đã có sẵn.

**Giải pháp:** app ghi chú desktop **local-first** lưu dữ liệu thuần **Markdown + YAML frontmatter**
mà người dùng sở hữu 100%, kèm **trợ lý AI dạng agent** thao tác trực tiếp trên notes và
**MCP server** cho phép AI client ngoài (ZCode, Claude Desktop…) cùng làm việc trên dữ liệu đó.

## 2. Mục tiêu sản phẩm

| # | Mục tiêu | Đo lường |
|---|---|---|
| G1 | Dữ liệu là file `.md` mở được bằng mọi editor | Mỗi note 1 file `<uuid>.md`, không DB |
| G2 | Agent AI thao tác thật trên notes, an toàn | 10 tools; xóa luôn qua thẻ xác nhận + hoàn tác |
| G3 | Chạy hoàn toàn local khi dùng Ollama | LLM traffic đi thẳng baseUrl, không qua server trung gian |
| G4 | Đa nhà cung cấp LLM (OpenAI-compatible) | Preset OpenAI / Ollama / OpenRouter / Groq / vLLM |
| G5 | Sync bằng thư mục cloud sẵn có | Mirror 2 chiều vào OneDrive/Drive, newer-wins |
| G6 | Mở hệ sinh thái AI qua MCP | Binary `dnt-note-mcp` stdio JSON-RPC, 7 tools |

## 3. Đối tượng người dùng

- **Người ghi chú cá nhân** muốn sở hữu dữ liệu dạng file văn bản (Markdown), không thích lock-in.
- **Người dùng AI năng cao** muốn assistant đọc/ghi notes, đính kèm tài liệu/ảnh vào hội thoại.
- **Developer / power user** muốn nối app vào MCP client (ZCode, Claude Desktop) hoặc tự hack dữ liệu.
- Nền tảng mục tiêu: **Windows 10/11** (WebView2); ngôn ngữ sản phẩm: **tiếng Việt** (có English).

## 4. Nguồn gốc dự án

- Là bản **rebuild Rust/Tauri 2** của [NoteStudio](https://github.com/dungnt1312/NoteStudio)
  (Swift/SwiftUI, macOS) — đạt full-parity các tính năng Phase 1–4.
- Identifier `com.dungnt.dntnote`, product name "DNT Note", private, version 0.1.0.
- Thiết kế gốc: [design spec](./superpowers/specs/2026-09-26-dnt-note-design.md) (approved).

## 5. Tính năng chính

| Tính năng | Mô tả chức năng | Trạng thái |
|---|---|---|
| **Notes CRUD + tags + pin + trash** | Tạo/sửa/xóa mềm ghi chú; tags trong frontmatter; ghim note; thùng rác + hoàn tác `Ctrl+Z`; tìm kiếm tức thời (title ưu tiên hơn body); demo seed 4 notes tiếng Việt lần đầu chạy | ✅ |
| **Editor CodeMirror live-preview** | Kiểu Obsidian: heading/bold/italic/code render tại chỗ, dòng focus hiện mã thô, checkbox click được, frontmatter ẩn; FormatBar toolbar Markdown; phím `Ctrl+B/I` v.v. | ✅ |
| **AI assistant (agent)** | Chat streaming; vòng lặp tool-calling tối đa 12 lượt; **10 tools** (`list_notes`, `search_notes`, `read_note`, `create_note`, `update_note`, `delete_note`, `get_stats`, `list_tags`, `set_tags`, `get_recent_notes`); `delete_note` chỉ phát `pendingDelete` → UI hiện thẻ xác nhận, không xóa ngầm; lịch sử chat lưu JSON mở lại được | ✅ |
| **Multi-provider OpenAI-compatible** | Preset OpenAI/Ollama/OpenRouter/Groq/vLLM; lưu nhiều model mỗi provider (fetch `GET /models` hoặc gõ tay); "Kiểm tra kết nối" trong Settings; đổi model nhanh ở header chat | ✅ |
| **Multimodal chat** | Đính kèm ảnh (paste/drag-drop/paperclip) gửi dạng `image_url` data URL cho vision model (downscale ≤2048px); file PDF/DOCX/text extract ≤20k ký tự; tổng ngữ cảnh ≤48k ký tự | ✅ (history rebuild đang hoàn thiện — xem [roadmap](./project-roadmap.md)) |
| **Composer Lexical @note token** | `@note` là token atomic inline trong câu (chip không sửa được), menu gợi ý bám caret fuzzy theo ghi chú, Esc đóng, Enter/Tab chọn; draft persist theo từng phiên chat | ✅ |
| **Editor↔chat bridge** | Right-click trong editor → "Gửi selection cho Assistant" (snippet) hoặc "Hỏi AI về note này" (@note token); handoff một-lần vào composer | ✅ |
| **Attachments + PDF export** | Đính kèm ảnh + file (allowlist ~30 đuôi, ≤25MB, ≤10 file/note); extract text on-device; xuất PDF qua cửa sổ in A4; dọn file mồ côi tự động (grace 7 ngày) | ✅ |
| **Quick capture + Tray** | Global shortcut `Ctrl+Shift+N` mở cửa sổ nhỏ always-on-top, Enter lưu note tag `quick`; tray icon: mở app / quick capture / thoát | ✅ |
| **MCP server** | Binary `dnt-note-mcp` stdio JSON-RPC MCP 2024-11-05, 7 tools (kèm `open_note` trả deep-link `dntnote://note/<id>`); dùng chung thư mục notes với app | ✅ |
| **Sync folder** | Chọn thư mục OneDrive/Drive trong Settings → mirror 2 chiều file `.md` + attachments; xung đột newer-wins theo frontmatter `updated`; watcher 500ms | ✅ |
| **i18n vi/en** | Toàn bộ UI chrome qua hệ dict `defineDict` parity vi/en; chuyển đổi trong Settings, persist | ✅ |
| **Theming** | Sáng / Tối / Hệ thống, design token "Studio" ánh xạ Tailwind v4 | ✅ |

## 6. Yêu cầu phi chức năng

- **Local-first:** mọi dữ liệu là file trong `%APPDATA%\com.dungnt.dntnote\`; app chạy được không cần
  mạng (trừ LLM cloud); ghi file luôn **atomic** (`.tmp` rồi rename) để tránh hỏng dữ liệu.
- **Privacy:** không telemetry, không server trung gian — LLM traffic đi thẳng từ app tới `baseUrl`
  provider (qua Tauri plugin-http, không CORS); extract PDF/DOCX on-device.
- **An toàn dữ liệu:** file hỏng frontmatter vẫn hiển thị dạng `⚠ <tên file>` **read-only**, không bị
  ghi đè; delete là soft-delete (rename sang `.trash/`), hoàn tác được.
- **Performance:** index notes in-memory, watcher debounce 300ms cập nhật khi sửa file ngoài ~1s;
  autosave 600ms; fuzzy search client-side.
- **Chất lượng:** 168 unit test TS (Vitest) + 52 unit test Rust (`cargo test`) — số liệu tại thời điểm
  README được cập nhật gần nhất, sẽ trôi theo development.

## 7. Phạm vi

**Trong phạm vi (in):** notes Markdown + frontmatter, AI agent + multimodal chat, attachments,
PDF export, quick capture, tray, MCP server, sync folder, i18n vi/en, theming, deep-link `dntnote://`.
Kế hoạch mở rộng: media library, Agent Skills, version history, wiki-links, semantic search,
voice, keyring (xem [project-roadmap](./project-roadmap.md) Phase 5–7).

**Ngoài phạm vi (out):**

- Nền tảng macOS/Linux (NoteStudio gốc đã phủ macOS; Tauri 2 cho phép mở rộng sau).
- Mobile app, web app, tài khoản/đăng nhập, sync server riêng, đồng bộ real-time đa thiết bị E2EE.
- Markdown WYSIWYG đầy đủ (editor giữ live-preview, không phải rich-text block).
- Công khai mã nguồn / license / phân phối store (hiện private, bundle NSIS tự cài).

## 8. Trạng thái hiện tại (v0.1.0)

- Phase 1–4 hoàn tất (notes core → AI assistant → attachments/export/quick capture/tray →
  MCP + sync); composer refactor kiểu ZCode + editor context-menu-to-AI hoàn tất.
- Đang làm: **multimodal chat history** (uncommitted trên branch `feat/phases-5-7`).
- Chi tiết lộ trình: [project-roadmap](./project-roadmap.md) · Kiến trúc kỹ thuật:
  [system-architecture](./system-architecture.md)
