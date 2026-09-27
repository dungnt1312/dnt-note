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
- **Lịch sử phiên bản**: snapshot tối đa mỗi 5 phút khi đang gõ + khi chuyển note, luôn chụp khi
  agent/MCP sửa (tối đa 1 lần/10s); giữ 50 bản/note, xem & khôi phục trong menu note
- **Wiki-links `[[Tiêu đề]]`**: gợi ý khi gõ `[[`, Ctrl+click mở note (tạo mới nếu chưa có),
  panel **Backlinks** dưới editor
- **Thùng rác** trong Cài đặt → Dữ liệu: xem danh sách, khôi phục hoặc xóa vĩnh viễn từng note
- **Ghi âm giọng nói**: thu âm trong editor → lưu vào Media, tùy chọn chép lời (transcription)
  qua model của provider

### 🤖 AI assistant (agent)
- Chat panel bên phải với **streaming** phản hồi; lịch sử chat lưu JSON mở lại được
- **15 tools** agent tự gọi: list/search/read/create/update/delete notes, backlinks, stats, tags,
  set_tags, recent, list_media, read_attachment, load_skill, semantic_search — xóa luôn có
  **thẻ xác nhận** + hoàn tác, không xóa ngầm
- **Multi-provider OpenAI-compatible**: OpenAI, Ollama (local), OpenRouter, Groq, vLLM — test kết
  nối trực tiếp trong Settings, chọn model ở header chat
- **@note mentions**: gõ `@` trong composer để đính kèm nội dung note (≤8k ký tự/note)
- **Đính kèm file vào chat** (ảnh gửi vision model, tài liệu được trích text)
- **Agent Skills**: thư mục `skills/<tên>/SKILL.md` (quản lý trong Cài đặt); gõ `/skill` trong
  composer để kích hoạt, agent cũng tự gọi `load_skill` khi phù hợp
- **Tìm kiếm ngữ nghĩa** (opt-in, tắt mặc định): gõ `?câu hỏi` trong palette. Khi bật, nội dung
  note được gửi tới endpoint embeddings của provider — dùng Ollama nếu muốn giữ dữ liệu tại máy
- **Gợi ý tiêu đề & thẻ** bằng AI (menu ⋯ của note): sửa tiêu đề, chọn thẻ rồi Áp dụng
- API key lưu trong **Windows Credential Manager**, không còn nằm trong `providers.json`
- Nếu Credential Manager không khả dụng, key được lưu dự phòng vào `providers.json` (kèm cảnh báo); bản Linux của keyring cần libdbus (chưa kiểm thử)

### 📎 Media + Export
- **Thư viện Media** (Ctrl+3): lưới ảnh/tệp, lọc, đổi tên, xóa, xem note nào đang dùng
- **Kéo-thả / dán** ảnh, tệp vào editor → tự lưu vào `attachments/` và chèn link; ảnh hiển thị ngay trong editor & preview
- Đính kèm ảnh + file (pdf, docx, txt, csv, code...) — tối đa 10 file/note, 25MB/file
- Extract text on-device (PDF, DOCX, plain text); ảnh **tự downscale ≤2048px** khi gửi vision model
- **Xuất PDF**: nút ⬇ trong editor → cửa sổ in A4 → Save as PDF
- Dọn file đính kèm mồ côi tự động lúc khởi động

### ⚡ Quick capture + Tray
- **Ctrl+Shift+N** (global shortcut): cửa sổ nhỏ luôn-on-top, gõ Enter lưu note mới
- Tray icon: mở app / quick capture / thoát

### 🔌 MCP server (`dnt-note-mcp`)
- Binary stdio JSON-RPC 2.0 chuẩn MCP cho AI client bên ngoài (ZCode, Claude Desktop, ...)
- 9 tools: `list_notes`, `search_notes`, `read_note` (offset/limit), `create_note`, `update_note`,
  `delete_note`, `open_note` (trả URL `dntnote://note/<id>` — app focus đúng note đó),
  `list_skills`, `get_skill`
- Đọc/ghi trực tiếp cùng thư mục notes → đồng bộ 2 chiều với app theo thời gian thực

### ☁️ Sync folder (thay iCloud)
- Chọn thư mục OneDrive/Google Drive bất kỳ trong Settings → mirror 2 chiều
- Xung đột resolve **newer-wins** theo `updated` trong frontmatter

## Chạy từ nguồn

Yêu cầu: **Node 20+**, **Rust 1.77+** (MSVC), WebView2 (Windows 10/11 có sẵn).

```bash
npm install
npm run tauri dev            # chạy app
npm test                     # 229 unit tests TS (vitest)
cd src-tauri && cargo test --workspace   # 89 unit tests Rust
npm run tauri build          # installer NSIS
```

## Cấu hình AI

1. Mở **Cài đặt → AI Providers** (app seed sẵn preset Ollama local)
2. Chọn preset (OpenAI/Ollama/OpenRouter/Groq/vLLM), điền API key nếu cần, bấm **Kiểm tra kết nối**
3. (Tùy chọn) đặt model embeddings/transcription cho tìm kiếm ngữ nghĩa và chép lời ghi âm
4. Chọn provider/model ở dropdown trong chat panel — xong

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
| `Ctrl+1` / `Ctrl+2` / `Ctrl+3` | Ghi chú / Trợ lý / Media |
| `Ctrl+Shift+J` | Trợ lý cạnh ghi chú |
| `Ctrl+Shift+O` | Hội thoại mới |
| `Ctrl+K` / `Ctrl+P` | Command palette (`?` = tìm ngữ nghĩa) |
| `[[` | Chèn wiki-link (trong editor) |
| `/` | Chọn skill (trong composer chat) |
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
├── notes\.history\<id>\ # lịch sử phiên bản (≤50 bản/note)
├── attachments\        # media & file đính kèm (tên = <uuid>-<tên hiển thị>)
├── skills\<tên>\SKILL.md # Agent Skills
├── chats\<id>.json     # lịch sử chat AI
├── embeddings.json     # chỉ mục tìm kiếm ngữ nghĩa (khi bật)
├── providers.json      # cấu hình LLM (API key ở Credential Manager)
└── settings.json       # onboarding, sync folder
```

## Kiến trúc

- `src-tauri/crates/notes-core` — Rust lib thuần: model + frontmatter, NotesStore
  (CRUD/search/tags/stats/atomic/trash/history/backlinks), media, skills, attachments (extract/resize/orphan), sync (mirror
  newer-wins), watcher (notify debounce)
- `src-tauri/crates/mcp-server` — binary `dnt-note-mcp` (stdio JSON-RPC, 9 unit tests)
- `src-tauri/src` — Tauri app: commands, tray, global shortcut, single-instance, deep-link
  (`dntnote://`), sync wiring
- `src/` — React 19 + TS + Tailwind 4 + zustand; CM6 live-preview tự viết
  (`src/lib/editor/livePreview.ts`); agent engine (`src/lib/agent/`) + SSE client
  (`src/lib/llm/openai.ts`) thuần TypeScript

Tài liệu: [design spec](docs/superpowers/specs/2026-09-26-dnt-note-design.md) ·
[plan Phase 1](docs/superpowers/plans/2026-09-26-phase-1-notes-core.md) ·
[plan Phase 2–4](docs/superpowers/plans/2026-09-26-phases-2-4-full-parity.md) ·
[spec Phase 5–7](docs/superpowers/specs/2026-09-27-phases-5-7-media-skills-extras-design.md) ·
[plan Phase 5–7](docs/superpowers/plans/2026-09-27-phases-5-7-media-skills-extras.md)

## Đã kiểm chứng

- ✅ 229 unit tests TS + 89 unit tests Rust đều pass
- ✅ `npm run build` (tsc + vite) sạch lỗi; installer NSIS build thành công
- ✅ App chạy thật: tray + quick capture window + watcher + demo seed
- ✅ MCP server pipe thật qua stdin/stdout: initialize → tools/list → tools/call đọc đúng 4 notes
- ✅ Chat panel + provider settings + mentions render đúng (browser check)
- ⬜ Checklist chạy tay (cần người): chat với LLM thật (cần key), Ctrl+Shift+N toàn hệ thống,
  deep-link từ trình duyệt, sync OneDrive thật
