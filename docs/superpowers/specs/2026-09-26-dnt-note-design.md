# DNT Note — Thiết kế (Design Spec)

Ngày: 2026-09-26
Trạng thái: Đã duyệt (user OK theo đề xuất, tự động triển khai)

## 1. Mục tiêu

Clone tính năng **full parity** với [NoteStudio](https://github.com/dungnt1312/NoteStudio) (app ghi chú macOS Swift/SwiftUI) sang stack **Rust + Tauri 2**, chạy **Windows trước** (macOS/Linux sau). Local-first, lưu notes dạng **file Markdown + YAML frontmatter**, có **AI assistant dạng agent** thao tác notes qua tools, kèm **MCP server** cho AI client bên ngoài.

### Không phải mục tiêu (Non-goals)
- Không làm backend/server — mọi thứ chạy local, LLM gọi trực tiếp OpenAI-compatible API.
- Không rebuild UI SwiftUI y hệt pixel — parity ở mức tính năng + phong cách ChatGPT-studio (sidebar + editor + chat panel).
- iCloud sync → thay bằng **sync folder tùy chọn** (OneDrive/Google Drive — thư mục người dùng chỉ định).

## 2. Tech Stack

| Lớp | Công nghệ |
|---|---|
| Shell | Tauri 2 (Windows trước), custom title bar, tray |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS 4 + shadcn/ui |
| State | Zustand |
| Editor | CodeMirror 6 + `@codemirror/lang-markdown` + `@lezer/markdown`, **live preview kiểu Obsidian** (render inline qua decorations, syntax ẩn trên dòng không focus) |
| Markdown render (chat/preview/print) | `react-markdown` + `remark-gfm` + `rehype-highlight` |
| Rust I/O | `notify` + `notify-debouncer-full` (watcher), `serde`/`serde_json`, frontmatter tự parse, `image` (downscale ảnh), `pdf-extract` + zip/xml (extract text) |
| LLM HTTP | Frontend `fetch` qua `tauri-plugin-http` (không CORS), SSE streaming |
| Lưu trữ cấu hình | `tauri-plugin-store` (JSON trong app-data) |
| MCP server | Binary Rust riêng, SDK `rmcp` (stdio) |
| Test | Rust: `cargo test` (tempdir); TS: `vitest` |

Kiến trúc tổng thể: **Phương án A (hybrid)** — agent loop + UI logic ở TypeScript; Rust làm file I/O, watcher, attachments, extract text. MCP server là binary Rust dùng chung crate `notes-core`.

## 3. Cấu trúc lưu trữ dữ liệu

```
%APPDATA%/com.dungnt.dntnote/
  notes/<uuid>.md          # frontmatter YAML: id, title, tags[], pinned, created, updated
                           # body: markdown thuần
  notes/.trash/<uuid>.md   # note đã xóa (undo/khôi phục; không tự xóa)
  attachments/             # file đính kèm, tên = <uuid>-<tên-gốc>
  chats/<chatId>.json      # các session chat AI
  providers.json           # cấu hình LLM providers (tên, baseURL, model, apiKey)
  settings.json            # theme, sync folder, shortcuts, onboarding flags
  demo/                    # template ghi chú demo, seed lần chạy đầu
```

Quy tắc:
- Ghi file **atomic**: ghi `<uuid>.md.tmp` rồi rename.
- Frontmatter lỗi (YAML sai, thiếu id) → note vẫn hiển thị ở danh sách "raw" với cảnh báo, không crash.
- File watcher debounce 300ms, emit event `notes://changed` (ids) lên frontend; app và MCP server cùng dùng cơ chế này.

## 4. Kiến trúc

### 4.1 Workspace Rust (`src-tauri/`)

```
src-tauri/
  Cargo.toml               # workspace: app, notes-core, mcp-server
  crates/notes-core/       # lib thuần, không phụ thuộc Tauri
    note.rs                # model Note, NoteFrontmatter
    note_file.rs           # parse/serialize .md + frontmatter (round-trip)
    store.rs               # NotesStore: CRUD, search, tags, stats (sync, trait)
    watcher.rs             # notify debounced, callback changed-ids
  crates/mcp-server/       # binary stdio MCP (rmcp), dùng notes-core
  src/                     # app Tauri
    lib.rs, main.rs
    state.rs               # AppState (Mutex<NotesStore>, settings store)
    commands/              # notes.rs, attachments.rs, chats.rs, settings.rs, stats.rs
```

`notes-core` có unit test riêng (CRUD trên tempdir, round-trip frontmatter, search). App Tauri và MCP server chỉ là 2 "consumer" của cùng storage — đúng như NoteStudio chia sẻ file .md giữa app và MCP.

### 4.2 Frontend (`src/`)

```
src/
  main.tsx, App.tsx
  lib/
    api/            # typed wrappers cho invoke (notes, chats, settings, attachments)
    llm/            # OpenAI-compatible client: SSE stream, chat/completions, /models test
    agent/          # AssistantEngine: agent loop, tool registry + schemas, execution
    editor/         # CM6 setup: live-preview extensions, checkbox widget, frontmatter
    store/          # zustand: notesStore, chatStore, settingsStore, uiStore
    theme/          # tokens (CSS variables), typography 11–28px, radius, light/dark
  components/
    layout/         # TitleBar, Sidebar, CommandPalette, QuickCapture
    notes/          # NoteList, NoteItem, Editor (CM6), EditorHeader, TagInput
    chat/           # ChatPanel, MessageList, Message, ToolCallCard, Composer, MentionPicker
    settings/       # SettingsDialog: Providers, Appearance, Data, About
    common/         # ConfirmDeleteCard, UndoToast, EmptyState
```

Luồng dữ liệu chính:
- **Notes:** UI → `api.notes.update` (debounce 600ms ở store) → Rust command → atomic write → watcher (nếu file đổi từ ngoài: MCP/OneDrive) → event `notes://changed` → store reload → UI.
- **Chat:** Composer → AssistantEngine.run(messages) → `llm.streamChat` (fetch SSE qua plugin-http) → assistant deltas render realtime → khi response có `tool_calls` → `agent.executeTool` → gọi api notes → append tool result → lặp lại (tối đa 12 vòng) → lưu chat JSON sau mỗi lượt.

### 4.3 Tauri commands (IPC surface)

Notes: `list_notes`, `read_note`, `create_note(title, body, tags)`, `update_note(id, patch)`, `delete_note(id)` (→ `.trash/`), `restore_note(id)`, `search_notes(query, limit)`, `list_tags`, `get_stats`.
Attachments: `save_attachment(noteId, path)`, `list_attachments(noteId)`, `delete_attachment`, `extract_text(path)`, `prepare_image(path)` (downscale 2048px → base64 cho vision).
Chats: `list_chats`, `load_chat(id)`, `save_chat(json)`, `delete_chat(id)`.
Settings: `get_providers/set_providers`, `get_settings/set_settings`, `seed_demo_notes`, `empty_trash`.
Events: `notes://changed`, `sync://status`.

Ngoài ra frontend dùng plugin: `http` (LLM calls), `store` (providers/settings), `dialog` (chọn file), `opener` (mở link/file ngoài), `global-shortcut` (quick capture), `single-instance` + `deep-link` (scheme `dntnote://note/<id>`).

## 5. Tính năng (parity với NoteStudio)

### 5.1 Notes core (Phase 1)
- CRUD note; danh sách sidebar: pinned trên cùng, sort theo `updated` desc; search tức thời (title + body, fuzzy đơn giản, client-side trên danh sách đã load —NotesStore đã có search cho MCP).
- Editor CM6 live preview kiểu Obsidian: heading/bold/italic/code/table/checkbox render inline; dòng focus hiện syntax; checkbox click được; frontmatter hiển thị mờ, không styled.
- Autosave debounce 600ms, chỉ báo "Saved/Saving…"; title sửa inline (H1 ảo phía trên editor).
- Tags: thêm/xóa/tag filter; pin note; xóa → thùng rác + toast Undo (Ctrl+Z).
- Theme Light/Dark/System; command palette Ctrl+K (search notes + actions); phím tắt: Ctrl+N (new), Ctrl+P (palette), Ctrl+F (search), Ctrl+S (force save).
- Ghi chú demo seed lần đầu chạy.

### 5.2 AI assistant (Phase 2)
- Chat panel bên phải editor (thu gọn được) + chế độ fullscreen; lịch sử chat lưu JSON, mở lại được.
- Multi-provider OpenAI-compatible: cấu hình nhiều provider (tên, baseURL, model, apiKey), test connection (`GET /models`), chọn model ở header chat. Hỗ trợ OpenAI, Ollama, OpenRouter, Groq, vLLM (chỉ là preset baseURL).
- Agent loop function-calling chuẩn OpenAI, streaming deltas, render markdown trong message.
- **10 tools:** `list_notes`, `search_notes`, `read_note`, `create_note`, `update_note`, `delete_note`, `get_stats`, `list_tags`, `set_tags`, `get_recent_notes`.
- Xóa an toàn: tool `delete_note` không xóa ngay — tạo **confirmation card** gộp trong chat; user bấm xác nhận mới chuyển `.trash/`; Undo toast khôi phục.
- `@note` mention trong composer (autocomplete) → chèn nội dung note vào context (truncated 8k ký tự).
- Tool call hiển thị dạng card thu gọn được (tên tool, tham số, kết quả tóm tắt).

### 5.3 Attachments + Export (Phase 3)
- Đính kèm ảnh + file (pdf, docx, rtf, odt, txt, md, csv, json, code) — tối đa 10 file/note, 25MB/file; lưu `attachments/`, note tham chiếu bằng markdown link; file không còn tham chiếu dọn lúc khởi động.
- Extract text on-device: PDF (`pdf-extract`), DOCX (zip + parse XML), còn lại đọc trực tiếp; ảnh downscale về tối đa 2048px cạnh lớn trước khi gửi vision model.
- Export PDF: cửa sổ print riêng render note (CSS A4, ẩn UI), gọi `window.print()`.
- Quick capture: global shortcut Ctrl+Shift+N mở cửa sổ nhỏ luôn-on-top, gõ Enter lưu note mới; tray icon với menu (New note, Quick capture, Quit).

### 5.4 MCP server + Sync (Phase 4)
- Binary `dnt-note-mcp` stdio (rmcp), tools: `list_notes`, `search_notes`, `read_note` (offset/limit), `create_note`, `update_note`, `delete_note` (→ .trash), `open_note` (mở app focus note qua `dntnote://note/<id>`).
- Watcher trong MCP server giữ app ↔ client sync 2 chiều real-time.
- Sync folder (thay iCloud): mirror notes dir sang thư mục người dùng chọn (OneDrive); conflict resolve **newer-wins** theo `updated`.

## 6. UI Layout (kiểu ChatGPT/Studio)

```
┌────────────────────────────────────────────────────────────┐
│ TitleBar (custom, drag): logo | search | theme | settings  │
├──────────┬──────────────────────────────┬──────────────────┤
│ Sidebar  │ Editor                       │ ChatPanel        │
│ + New    │ ┌ Title (inline)            ┐│ (thu gọn được)   │
│ search   │ │ CM6 live-preview          ││ header: model ▾  │
│ PINNED   │ │                           ││ messages (md)    │
│ ALL      │ │                           ││ tool cards       │
│ (title,  │ └ tags, pin, attach, export┘│ composer @note   │
│ snippet, │                             │                  │
│ date)    │                             │                  │
└──────────┴──────────────────────────────┴──────────────────┘
```

Design tokens tập trung ở `theme/tokens.css` (đối ứng `Theme.swift` bên NoteStudio): typography scale 11–28px, radii, màu light/dark qua CSS variables, secondary text contrast ≥ 4.5:1.

## 7. Xử lý lỗi

- Rust commands: `Result<T, AppError>`; `AppError` enum (thiserror) serialize `{code, message}`; frontend toast.
- Ghi file atomic; lỗi watcher chỉ log + banner nếu notes dir không đọc được.
- LLM lỗi (network, 4xx/5xx, key sai): message lỗi trong chat kèm nút Retry; abort stream khi đóng panel.
- Frontmatter parse lỗi: note raw + cảnh báo, không mất dữ liệu.
- Chat JSON save best-effort (lỗi → cảnh báo, không chặn chat).

## 8. Testing & Verification

- **Rust unit tests** (`cargo test` trong workspace): note_file round-trip (frontmatter edge: tag chứa `:`, multiline body, CRLF), NotesStore CRUD/search/tags trên tempdir, watcher debounce, atomic write.
- **TS unit tests** (vitest): agent tool schemas hợp lệ, agent loop (mock provider), markdown utils, stores (autosave debounce, trash undo).
- **Component tests**: NoteList filter, ToolCallCard render, MentionPicker.
- **Smoke checklist mỗi phase** chạy tay trên `npm run tauri dev` (build Windows trước; installer `.msi`/`.exe` NSIS sau Phase 4).
- TDD trong lúc implement theo superpowers workflow.

## 9. Lộ trình (4 phase, mỗi phase 1 plan + implement riêng)

1. **Phase 1 — Notes core:** workspace Rust + notes-core (CRUD/search/watcher/atomic), Tauri commands, UI 3 cột, CM6 live preview, autosave, tags/pin/trash+undo, search, palette, theme, demo notes, settings khung.
2. **Phase 2 — AI assistant:** providers UI + llm client SSE + agent loop + 10 tools + chat panel + mentions + confirmation card + chat history.
3. **Phase 3 — Attachments + export:** đính kèm, extract text, downscale ảnh, PDF print, quick capture (tray + global shortcut), dọn file mồ côi.
4. **Phase 4 — MCP + sync:** binary rmcp stdio, deep-link, sync folder newer-wins, build installer.

## 10. Quy ước

- Tên app: **DNT Note**; identifier `com.dungnt.dntnote`; scheme `dntnote://`.
- Commit theo phase, message kiểu `phase-1: ...`.
- Code comment tiếng Anh, tài liệu/spec tiếng Việt.
- Windows-first: phím tắt dùng Ctrl (móc thêm Cmd khi port macOS).
