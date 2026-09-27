# DNT Note

Ứng dụng ghi chú desktop **local-first** cho Windows với **trợ lý AI dạng agent**, lưu dữ liệu thành
**file Markdown + frontmatter** bạn hoàn toàn sở hữu. Lấy cảm hứng từ
[NoteStudio](https://github.com/dungnt1312/NoteStudio) (Swift/SwiftUI, macOS), xây lại bằng
**Rust + Tauri 2** để chạy đa nền tảng.

## Tính năng

### 📝 Notes core
- **Editor Markdown live-preview kiểu Obsidian** (CodeMirror 6): heading/bold/italic/code render
  ngay trong editor, dòng đang focus hiện mã nguồn thô, checkbox click được
- Lưu **file `.md`** + YAML frontmatter, autosave 600ms (ghi atomic), thùng rác + **Ctrl+Z hoàn tác**
- Tìm kiếm tức thời, command palette **Ctrl+K** fuzzy search, tags, ghim note, theme Sáng/Tối/Hệ thống
- **File watcher**: sửa file ngoài app (editor khác, git, MCP, cloud) → app cập nhật ~1s

### 🤖 AI assistant (agent)
- Chat panel bên phải với **streaming** phản hồi; lịch sử chat lưu JSON mở lại được
- **10 tools** agent tự gọi: list/search/read/create/update/delete notes, stats, tags, set_tags,
  recent — xóa luôn có **thẻ xác nhận** + hoàn tác, không xóa ngầm
- **Multi-provider OpenAI-compatible**: OpenAI, Ollama (local), OpenRouter, Groq, vLLM — test kết
  nối trực tiếp trong Settings, lưu **nhiều model mỗi nhà cung cấp** (lấy từ `GET /models` hoặc gõ
  tay), đổi model nhanh ở header chat
- **@note mentions**: gõ `@` trong composer để đính kèm nội dung note (≤8k ký tự/note)

### 📎 Attachments + Export
- Đính kèm ảnh + file (pdf, docx, txt, csv, code...) — tối đa 10 file/note, 25MB/file
- Extract text on-device (PDF, DOCX, plain text); ảnh **tự downscale ≤2048px** khi gửi vision model
- **Xuất PDF**: nút ⬇ trong editor → cửa sổ in A4 → Save as PDF
- Dọn file đính kèm mồ côi tự động lúc khởi động

### ⚡ Quick capture + Tray
- **Ctrl+Shift+N** (global shortcut): cửa sổ nhỏ luôn-on-top, gõ Enter lưu note mới
- Tray icon: mở app / quick capture / thoát

### 🔌 MCP server (`dnt-note-mcp`)
- Binary stdio JSON-RPC 2.0 chuẩn MCP cho AI client bên ngoài (ZCode, Claude Desktop, ...)
- 7 tools: `list_notes`, `search_notes`, `read_note` (offset/limit), `create_note`, `update_note`,
  `delete_note`, `open_note` (trả URL `dntnote://note/<id>` — app focus đúng note đó)
- Đọc/ghi trực tiếp cùng thư mục notes → đồng bộ 2 chiều với app theo thời gian thực

### ☁️ Sync folder (thay iCloud)
- Chọn thư mục OneDrive/Google Drive bất kỳ trong Settings → mirror 2 chiều
- Xung đột resolve **newer-wins** theo `updated` trong frontmatter

## Chạy từ nguồn

Yêu cầu: **Node 20+**, **Rust 1.77+** (MSVC), WebView2 (Windows 10/11 có sẵn).

```bash
npm install
npm run tauri dev            # chạy app
npm test                     # 121 unit tests TS (vitest)
cd src-tauri && cargo test --workspace   # 43 unit tests Rust
npm run tauri build          # installer NSIS
```

## Cấu hình AI

1. Mở **Cài đặt → AI Providers** (app seed sẵn preset Ollama local)
2. Chọn preset (OpenAI/Ollama/OpenRouter/Groq/vLLM), điền API key nếu cần, bấm **Kiểm tra kết nối**
3. Bấm **Chọn model…** → tick các model muốn dùng (tìm kiếm được, hoặc gõ tên để thêm model không có
   trong danh sách) → **Lưu**
4. Đổi model ở dropdown trong chat panel (model được nhóm theo nhà cung cấp) — xong

## Dùng MCP server với AI client

Build binary: `cd src-tauri && cargo build -p mcp-server` → `target/debug/dnt-note-mcp.exe`.
Thêm vào config client của bạn (vd ZCode/Claude Desktop):

```json
{
  "mcpServers": {
    "dnt-note": {
      "command": "C:\\path\\to\\dnt-note-mcp.exe",
      "args": ["C:\\Users\\<you>\\AppData\\Roaming\\com.dungnt.dntnote\\notes"]
    }
  }
}
```

Bỏ `args` để dùng thư mục mặc định (`%APPDATA%\com.dungnt.dntnote\notes`). Tool `open_note` trả
URL `dntnote://note/<id>` — mở URL đó sẽ focus note trong app (cần app đang chạy).

## Phím tắt

| Phím | Chức năng |
|---|---|
| `Ctrl+N` | Ghi chú mới |
| `Ctrl+K` / `Ctrl+P` | Command palette |
| `Ctrl+F` | Tìm trong ghi chú |
| `Ctrl+S` | Lưu ngay |
| `Ctrl+Z` | Hoàn tác xóa ghi chú |
| `Ctrl+Shift+N` | Quick capture (toàn hệ thống) |
| `Esc` | Đóng palette / cài đặt |

## Dữ liệu nằm ở đâu?

```
%APPDATA%\com.dungnt.dntnote\
├── notes\<uuid>.md     # ghi chú (frontmatter + markdown)
├── notes\.trash\       # thùng rác
├── attachments\        # file đính kèm (tên = <uuid>-<tên gốc>)
├── chats\<id>.json     # lịch sử chat AI
├── providers.json      # cấu hình LLM (key nằm ở đây)
└── settings.json       # onboarding, sync folder
```

## Kiến trúc

- `src-tauri/crates/notes-core` — Rust lib thuần: model + frontmatter, NotesStore
  (CRUD/search/tags/stats/atomic/trash), attachments (extract/resize/orphan), sync (mirror
  newer-wins), watcher (notify debounce)
- `src-tauri/crates/mcp-server` — binary `dnt-note-mcp` (stdio JSON-RPC, 8 unit tests)
- `src-tauri/src` — Tauri app: commands, tray, global shortcut, single-instance, deep-link
  (`dntnote://`), sync wiring
- `src/` — React 19 + TS + Tailwind 4 + zustand; CM6 live-preview tự viết
  (`src/lib/editor/livePreview.ts`); agent engine (`src/lib/agent/`) + SSE client
  (`src/lib/llm/openai.ts`) thuần TypeScript

Tài liệu: [design spec](docs/superpowers/specs/2026-09-26-dnt-note-design.md) ·
[plan Phase 1](docs/superpowers/plans/2026-09-26-phase-1-notes-core.md) ·
[plan Phase 2–4](docs/superpowers/plans/2026-09-26-phases-2-4-full-parity.md)

## Đã kiểm chứng

- ✅ 70 unit tests TS + 43 unit tests Rust đều pass
- ✅ `npm run build` (tsc + vite) sạch lỗi; installer NSIS build thành công
- ✅ App chạy thật: tray + quick capture window + watcher + demo seed
- ✅ MCP server pipe thật qua stdin/stdout: initialize → tools/list → tools/call đọc đúng 4 notes
- ✅ Chat panel + provider settings + mentions render đúng (browser check)
- ⬜ Checklist chạy tay (cần người): chat với LLM thật (cần key), Ctrl+Shift+N toàn hệ thống,
  deep-link từ trình duyệt, sync OneDrive thật
