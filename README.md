# DNT Note

Ứng dụng ghi chú desktop **local-first** cho Windows, lưu dữ liệu thành **file Markdown + frontmatter**
bạn hoàn toàn sở hữu. Lấy cảm hứng từ [NoteStudio](https://github.com/dungnt1312/NoteStudio)
(Swift/SwiftUI, macOS), xây lại bằng **Rust + Tauri 2** để chạy đa nền tảng.

## Tính năng (Phase 1 — Notes Core)

- ✍️ **Editor Markdown live-preview kiểu Obsidian** (CodeMirror 6): heading/bold/italic/code
  render ngay trong editor, dòng đang focus hiện mã nguồn thô, checkbox click được
- 📁 **Lưu file `.md`** với YAML frontmatter (`id, title, tags, pinned, created, updated`)
  trong thư mục dữ liệu — dùng được với bất kỳ editor/git/cloud nào
- 🔍 Tìm kiếm tức thời (title + snippet), command palette **Ctrl+K** với fuzzy search
- 🏷️ Tags, ghim (pin) ghi chú, filter theo tag
- 🗑️ Xóa → thùng rác (`.trash/`) + **hoàn tác Ctrl+Z** trong 10 giây
- 💾 Autosave debounce 600ms, ghi file atomic
- 👁️ **File watcher**: sửa file ngoài app (editor khác, git, cloud sync) → app cập nhật trong ~1s
- 🌗 Theme Sáng / Tối / Theo hệ thống
- 📝 4 ghi chú demo tạo sẵn lần chạy đầu

## Đang phát triển (theo [spec](docs/superpowers/specs/2026-09-26-dnt-note-design.md))

- **Phase 2** — AI assistant dạng agent (10 tools thao tác notes), multi-provider OpenAI-compatible,
  streaming chat, @note mentions
- **Phase 3** — Attachments, extract text PDF/DOCX, export PDF, quick capture (tray + global shortcut)
- **Phase 4** — MCP server (`dnt-note-mcp`, stdio) + sync folder (OneDrive/Google Drive)

## Chạy từ nguồn

Yêu cầu: **Node 20+**, **Rust 1.77+** (MSVC trên Windows), WebView2 (Windows 10/11 có sẵn).

```bash
npm install
npm run tauri dev      # chạy app chế độ dev
npm test               # unit tests (vitest)
cd src-tauri && cargo test   # unit tests Rust (notes-core)
npm run tauri build    # đóng gói installer NSIS
```

## Phím tắt

| Phím | Chức năng |
|---|---|
| `Ctrl+N` | Ghi chú mới |
| `Ctrl+K` / `Ctrl+P` | Command palette |
| `Ctrl+F` | Tìm trong ghi chú |
| `Ctrl+S` | Lưu ngay |
| `Ctrl+Z` | Hoàn tác xóa ghi chú (trong 10s) |
| `Esc` | Đóng palette / cài đặt |

## Dữ liệu nằm ở đâu?

```
%APPDATA%\com.dungnt.dntnote\
├── notes\<uuid>.md     # ghi chú (frontmatter + markdown)
├── notes\.trash\       # thùng rác
├── chats\              # (Phase 2) lịch sử chat AI
├── providers.json      # (Phase 2) cấu hình LLM
└── settings.json
```

Xóa dữ liệu demo: xóa nội dung thư mục `notes\` rồi khởi động lại app.

## Kiến trúc (tóm tắt)

- `src-tauri/crates/notes-core` — Rust lib thuần: model, parse/serialize frontmatter,
  `NotesStore` (CRUD/search/tags/stats/atomic write), file watcher (notify, debounce 300ms)
- `src-tauri/src` — Tauri app: commands mỏng bọc notes-core, seed demo, emit event `notes://changed`
- `src/` — React 19 + TS + Tailwind 4 + zustand; editor CodeMirror 6 với extension
  live-preview tự viết (`src/lib/editor/livePreview.ts`)

Chi tiết đầy đủ: [design spec](docs/superpowers/specs/2026-09-26-dnt-note-design.md) ·
[implementation plan](docs/superpowers/plans/2026-09-26-phase-1-notes-core.md)

## Đã kiểm chứng (Phase 1)

- ✅ 39 unit tests TS (vitest) + 20 unit tests Rust (cargo) đều pass
- ✅ `npm run build` (tsc + vite) sạch lỗi
- ✅ App chạy thật: seed 4 demo notes đúng frontmatter, watcher hoạt động
- ✅ UI render đúng light/dark, palette mở được, empty state đúng
- ⬜ Checklist chạy tay (cần người): sửa note → autosave; tạo file .md ngoài → app nhận;
  xóa → Ctrl+Z; cài đặt → mở thư mục dữ liệu
