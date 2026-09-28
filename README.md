# DNT Note

Ứng dụng ghi chú desktop **local-first** cho Windows với **trợ lý AI dạng agent**, lưu dữ liệu thành
**file Markdown + frontmatter** bạn hoàn toàn sở hữu. Lấy cảm hứng từ
[NoteStudio](https://github.com/dungnt1312/NoteStudio) (Swift/SwiftUI, macOS), xây lại bằng
**Rust + Tauri 2** để chạy đa nền tảng.

## Tính năng

### 📝 Notes core
- **Editor Markdown live-preview kiểu Obsidian** (CodeMirror 6): heading/bold/italic/code render
  ngay trong editor, dòng đang focus hiện mã nguồn thô, checkbox click được, FormatBar toolbar
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
- Chat panel với **streaming** phản hồi; lịch sử chat lưu JSON mở lại được
- **10 tools** agent tự gọi: `list_notes`, `search_notes`, `read_note`, `create_note`,
  `update_note`, `delete_note`, `get_stats`, `list_tags`, `set_tags`, `get_recent_notes` —
  xóa luôn có **thẻ xác nhận** + hoàn tác, không xóa ngầm
- **Multi-provider OpenAI-compatible**: OpenAI, Ollama (local), OpenRouter, Groq, vLLM — test kết
  nối trực tiếp trong Settings, lưu **nhiều model mỗi nhà cung cấp** (lấy từ `GET /models` hoặc gõ
  tay), đổi model nhanh ở header chat
- **Composer kiểu ZCode** (rich editor Lexical): `@note` là **token inline ngay trong câu**
  (≤8k ký tự/note), menu gợi ý bám caret, Esc đóng, Enter/Tab chọn
- **Editor → AI (right-click)**: chọn text trong note → menu ngữ cảnh "Gửi selection cho
  Assistant" (snippet) hoặc "Hỏi AI về note này" (note thành @note token)
- **Đính kèm file vào chat**: nút paperclip, **paste ảnh**, kéo-thả (overlay "Thả file để đính
  kèm"), paste text dài → tự thành file `.txt`; ảnh downscale ≤2048px gửi dạng **vision parts**,
  PDF/DOCX/text extract ≤20k ký tự; tổng ngữ cảnh ẩn ≤48k ký tự
- **Safe send**: draft chỉ xoá khi tin nhắn được chấp nhận (thiếu provider/model → giữ nguyên
  nội dung); draft lưu theo từng phiên chat (khôi phục khi chuyển lại)
- **Retry gắn với message**: gửi lại đọc lại nội dung note/file mới nhất từ metadata tin nhắn;
  mỗi lần chạy có abort controller riêng (Stop không đè lẫn nhau)
- Lịch sử chat lưu **metadata có cấu trúc** (mentions, attachments, lỗi) → mở lại vẫn hiện đầy
  đủ chip; file đính kèm chat được bảo vệ khỏi dọn dẹp mồ côi. *Tái dựng ảnh/file từ các turn
  cũ khi gửi tiếp đang hoàn thiện (xem [roadmap](docs/project-roadmap.md)).*

### 📎 Media + Export
- **Thư viện Media** (Ctrl+3): lưới ảnh/tệp, lọc, đổi tên, xóa, xem note nào đang dùng
- **Kéo-thả / dán** ảnh, tệp vào editor → tự lưu vào `attachments/` và chèn link; ảnh hiển thị ngay trong editor & preview
- Đính kèm ảnh + file (pdf, docx, txt, csv, code...) — tối đa 10 file/note, 25MB/file
- Extract text on-device (PDF, DOCX, plain text); ảnh **tự downscale ≤2048px** khi gửi vision model
- **Xuất PDF**: nút ⬇ trong editor → cửa sổ in A4 → Save as PDF
- Dọn file đính kèm mồ côi tự động lúc khởi động (chỉ xóa file không dùng quá 7 ngày)

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

### 🌍 i18n + Theming
- UI tiếng Việt / English (chuyển trong Settings); theme Sáng/Tối/Hệ thống theo token "Studio"

## Chạy từ nguồn

Yêu cầu: **Node 20+**, **Rust 1.77+** (MSVC), WebView2 (Windows 10/11 có sẵn).

```bash
npm install
npm run tauri dev            # chạy app
npm test                     # unit tests TS (vitest)
cd src-tauri && cargo test --workspace   # unit tests Rust
npm run tauri build          # installer NSIS
```

## Cấu hình AI

1. Mở **Cài đặt → AI Providers** (app seed sẵn preset Ollama local)
2. Chọn preset (OpenAI/Ollama/OpenRouter/Groq/vLLM), điền API key nếu cần, bấm **Kiểm tra kết nối**
3. Bấm **Chọn model…** → tick các model muốn dùng (tìm kiếm được, hoặc gõ tên để thêm model không có
   trong danh sách) → **Lưu**
4. Đổi model ở dropdown trong chat panel (model được nhóm theo nhà cung cấp) — xong

## Dùng MCP server với AI client

Build binary: `cd src-tauri && cargo build -p mcp-server` → `target/debug/dnt-note-mcp.exe`
(release: thêm `--release` → `target/release/`). Thêm vào config client của bạn
(vd ZCode/Claude Desktop):

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
| `Ctrl+1` / `Ctrl+2` | Chuyển tab Notes / Assistant |
| `Ctrl+,` | Mở Settings |
| `Ctrl+S` | Lưu ngay (trong editor) |
| `Ctrl+Z` | Hoàn tác xóa ghi chú |
| `Ctrl+Shift+N` | Quick capture (toàn hệ thống) |
| `Esc` | Đóng palette / cài đặt |

Trong editor: `Ctrl+B/I` bold/italic, FormatBar có heading/list/quote/code/table; chat composer:
`Enter` gửi, `Shift+Enter` xuống dòng, `@` gọi menu mention, `Backspace` xóa cả chip token.

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

## Kiến trúc (tóm tắt)

- **UI** `src/` — React 19 + TS + Tailwind 4 + zustand; CM6 live-preview tự viết
  (`src/lib/editor/livePreview.ts`); agent engine (`src/lib/agent/`) + SSE client
  (`src/lib/llm/openai.ts`) chạy **thuần TypeScript**, gọi LLM trực tiếp qua Tauri plugin-http
  (không CORS, không qua Rust)
- **Rust app** `src-tauri/src` — 23 commands (notes/chats/attachments/stats/sync), tray,
  global shortcut, single-instance, deep-link `dntnote://`, watcher, sync wiring
- **Crates** — `notes-core` (lib thuần: store CRUD/atomic/trash, attachments, sync, watcher) +
  `mcp-server` (binary `dnt-note-mcp` stdio JSON-RPC, tái dùng notes-core)

Sơ đồ chi tiết, vòng đời dữ liệu, mô hình agent, bảo mật:
[docs/system-architecture.md](docs/system-architecture.md).

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [project-overview-pdr.md](docs/project-overview-pdr.md) | Vấn đề, mục tiêu, tính năng, yêu cầu phi chức năng, phạm vi |
| [codebase-summary.md](docs/codebase-summary.md) | Số liệu LOC, cấu trúc thư mục, tech stack, scripts, cách test |
| [code-standards.md](docs/code-standards.md) | Quy ước tổ chức, state/i18n/styling, Rust, testing, commits, nợ kỹ thuật |
| [system-architecture.md](docs/system-architecture.md) | Sơ đồ 3 lớp, crates, vòng đời note, agent, MCP, bảo mật |
| [project-roadmap.md](docs/project-roadmap.md) | Lộ trình Phase 1–7, feature arcs, đang thực hiện |
| [deployment-guide.md](docs/deployment-guide.md) | Build, installer, MCP binary, cấu hình sau cài, backup, troubleshoot |
| [design-guidelines.md](docs/design-guidelines.md) | Token "Studio", theming, layout, primitives, a11y, copywriting |

Văn bản thiết kế gốc (specs/plans, không thay đổi trong quá trình code thường ngày):
[design spec](docs/superpowers/specs/2026-09-26-dnt-note-design.md) ·
[Phase 1 plan](docs/superpowers/plans/2026-09-26-phase-1-notes-core.md) ·
[Phase 2–4 plan](docs/superpowers/plans/2026-09-26-phases-2-4-full-parity.md) ·
[Phases 5–7 spec](docs/superpowers/specs/2026-09-27-phases-5-7-media-skills-extras-design.md).

## Đã kiểm chứng

- ✅ Unit tests TS (Vitest) + 52 unit tests Rust đều pass (mốc gần nhất: 168 TS)
- ✅ `npm run build` (tsc + vite) sạch lỗi; installer NSIS build thành công
- ✅ App chạy thật: tray + quick capture window + watcher + demo seed
- ✅ MCP server pipe thật qua stdin/stdout: initialize → tools/list → tools/call đọc đúng 4 notes
- ✅ Chat panel + provider settings + mentions render đúng (browser check)
- ⬜ Checklist chạy tay (cần người): chat với LLM thật (cần key, kèm ảnh vision), paste ảnh/kéo-thả
  file vào composer, Ctrl+Shift+N toàn hệ thống, deep-link từ trình duyệt, sync OneDrive thật
  — xem [deployment-guide](docs/deployment-guide.md#5-kiểm-thử-trước-phát-hành)
