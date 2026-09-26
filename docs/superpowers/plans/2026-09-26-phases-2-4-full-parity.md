# DNT Note — Phases 2–4 (Full Parity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện full parity với NoteStudio: AI assistant dạng agent (10 tools, multi-provider), attachments + PDF export + quick capture/tray, MCP server + sync folder.

**Architecture:** Giữ phương án A — agent loop + LLM SSE ở TypeScript (qua `tauri-plugin-http`), Rust làm I/O nặng (attachments, extract text, tray, MCP server binary riêng). Chat history lưu JSON ở app-data qua commands Rust. MCP server hand-rolled stdio JSON-RPC (dùng chung `notes-core`, có unit test feed JSON lines — không thêm rmcp để tránh churn API).

**Tech Stack:** thêm `tauri-plugin-http`, `tauri-plugin-global-shortcut`, `tauri-plugin-single-instance`, `tauri-plugin-deep-link`, crate `image`, `pdf-extract`, `zip`; frontend thêm `react-markdown`, `remark-gfm`.

## Global Constraints

- Giữ nguyên mọi quy ước Phase 1 (camelCase serde, atomic write, `notes://changed`, autosave 600ms).
- LLM: chỉ giao thức OpenAI-compatible `POST {baseUrl}/chat/completions` (stream SSE) + `GET {baseUrl}/models`. Keys lưu `providers.json` qua plugin-store (JS API), không qua Rust.
- Agent loop tối đa 12 vòng tool-calls; tool `delete_note` KHÔNG xóa ngay — trả `pending_delete_id`, UI hiển thị confirmation card, user xác nhận mới gọi `api.notes.del`.
- Attachments: tối đa 10 file/note, 25MB/file; lưu `attachments/<uuid>-<tên-gốc>`; note tham chiếu bằng link markdown `…(attachments/<file>)`; ảnh vision downscale cạnh lớn ≤2048px.
- MCP server: binary `dnt-note-mcp`, stdio JSON-RPC 2.0 (MCP 2024-11-05: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`), 7 tools gồm `open_note` → trả URL `dntnote://note/<id>`.
- Sync: mirror 2 chiều `notes/ ↔ syncFolder`, conflict newer-wins theo `updated` trong frontmatter; sync chạy khi watcher báo và khi start.
- Capabilities: tạo `src-tauri/capabilities/default.json` (thiếu từ Phase 1 — bắt buộc cho plugin permissions: core:default, store, http với scope `https://**` + `http://localhost:**`, opener, dialog, global-shortcut, deep-link, single-instance).

---

## Phase 2 — AI Assistant

### Task P2.1: Capabilities + chat commands (Rust)

**Files:** Create `src-tauri/capabilities/default.json`, `src-tauri/src/commands/chats.rs`; Modify `Cargo.toml` (+tauri-plugin-http), `lib.rs`, `commands/mod.rs`.

- [ ] Capabilities JSON (core:default; store:default; http:default + allow `https://**`, `http://localhost:**`, `http://127.0.0.1:**`; opener:default; dialog:default). `cargo check` pass = capability schema hợp lệ.
- [ ] chats.rs: `list_chats() -> Vec<ChatMeta{id,title,updated}>`, `load_chat(id) -> ChatSession`, `save_chat(session) -> ()`, `delete_chat(id)`. File `chats/<id>.json` (atomic write từ notes-core::store::write_atomic). Test round-trip trên tempdir.
- [ ] lib.rs: plugin http + handler mới. `npm run tauri dev` smoke: invoke list_chats trả [].

### Task P2.2: LLM client + agent engine (TDD, TS)

**Files:** Create `src/lib/llm/openai.ts` + `openai.test.ts`, `src/lib/agent/tools.ts` + `tools.test.ts`, `src/lib/agent/engine.ts` + `engine.test.ts`.

- [ ] `parseSseLine(buffer) -> {deltas[], rest}`: tách `data: {...}\n\n`, bỏ `data: [DONE]`, trả JSON. Test: chunk cắt giữa dòng, nhiều event 1 chunk, [DONE].
- [ ] `streamChat({baseUrl, apiKey, model, messages, tools, signal, onDelta, onToolCallDelta}) -> {content, toolCalls[]}`: fetch stream, gom tool_calls delta theo index (id/function.name/arguments nối chuỗi). Test với ReadableStream mock.
- [ ] `listModels(baseUrl, key)` GET /models → string[].
- [ ] tools.ts: 10 schema (list_notes, search_notes, read_note, create_note, update_note, delete_note, get_stats, list_tags, set_tags, get_recent_notes) + `executeTool(name, args)` gọi api.notes; delete_note trả `{pendingDelete: id, title}` KHÔNG xóa. Test: schema đủ (name/description/parameters), executeTool mock api map đúng tên.
- [ ] engine.ts `runAgent({provider, messages, tools, onEvent, signal})`: system prompt (thống kê + note đang mở + luật xóa), loop ≤12: streamChat → nếu toolCalls: emit tool_start/tool_result, executeTool, push tool result message, tiếp tục; không toolCalls → kết thúc. Test: fake streamChat lần 1 trả toolCall, lần 2 trả text → đúng thứ tự events, messages gửi lại chứa tool result role "tool".

### Task P2.3: chatStore + Chat UI

**Files:** Create `src/lib/store/chatStore.ts` (+test), `src/lib/store/settingsStore.ts` (+test), `src/components/chat/*` (ChatPanel, MessageList, Message, ToolCallCard, DeleteConfirmCard, Composer, MentionPicker, ModelPicker), `src/components/settings/ProvidersSection.tsx`; Modify `App.tsx` (cột 3), `SettingsDialog.tsx` (tab Providers), `package.json` (+react-markdown, remark-gfm).

- [ ] settingsStore: providers[] CRUD + activeId/model; persist qua plugin-store JS API (`load('providers.json', {autoSave: true})`); presets: OpenAI/Ollama/OpenRouter/Groq/vLLM baseURL. testConnection() gọi listModels.
- [ ] chatStore: messages[], status(idle|streaming), send(text, mentions[]) — mentions chèn context note (≤8k ký tự); confirmDelete(id) gọi del + pushToast undo; lịch sử: newChat/loadChat/save sau mỗi lượt (debounce 800ms).
- [ ] ChatPanel: header (model picker + nút new chat + fullscreen toggle + đóng), MessageList (react-markdown + gfm, code block copy), ToolCallCard (thu gọn: tên tool + args + kết quả), DeleteConfirmCard (nút Xác nhận/Hủy), Composer (Enter gửi, Shift+Enter xuống dòng, @ trigger MentionPicker list 8 notes). abort nút Stop (AbortController).
- [ ] Wire: App thêm ChatPanel cột phải (width 380, ẩn/hiện), nút mở chat ở TitleBar.

### Task P2.4: Verify Phase 2

- [ ] `npm test` pass (mới: SSE parser, agent engine mock, tools schema, stores), `cargo test` pass, `npm run build` pass.
- [ ] Smoke browser (mock): ChatPanel render, gửi message với mock fetch → message + tool card + markdown render.
- [ ] Commit: `phase-2: ...` (3–4 commit theo task).

---

## Phase 3 — Attachments + Export + Quick Capture

### Task P3.1: Attachments commands (Rust, TDD)

**Files:** Modify workspace Cargo (+image, pdf-extract, zip); Create `src-tauri/src/commands/attachments.rs`; Modify notes-core `store.rs` (thêm `collect_attachment_refs(dir) -> HashSet<String>` quét link `attachments/` trong mọi note body).

- [ ] `save_attachment(note_id, src_path) -> StoredFile{name,size}`: validate ext + ≤25MB + đếm ≤10/note (đếm ref trong body); copy `attachments/<uuid>-<name>`. Test tempdir.
- [ ] `extract_text(path) -> String`: .pdf → pdf-extract; .docx → zip read `word/document.xml` + strip tags; còn lại đọc file. Test: txt + docx giả lập (zip tự tạo) + pdf skip (crate tự test).
- [ ] `prepare_image(path) -> ImageData{dataUrl, mime}`: image crate mở, resize cạnh lớn >2048 → 2048, encode JPEG/PNG → base64. Test với PNG tự generate (image crate).
- [ ] `cleanup_orphan_attachments() -> usize`: so attachments dir vs collect_attachment_refs, xóa file không ref. Test tempdir.
- [ ] list_attachments(note_id) — quét body; delete_attachment(name).

### Task P3.2: Attach UI + PDF export

**Files:** Create `src/components/notes/PrintView.tsx`; Modify `NoteEditor.tsx` (nút 📎 + export ⬇), `App.tsx` (?print= route + print CSS), `api/notes.ts` (+attachments), `index.css` (@media print).

- [ ] 📎 → plugin-dialog open (filter file) → save_attachment → chèn link cuối body (ảnh: `![]()`, file: `[]()`), toast.
- [ ] Export PDF: `?print=<id>` → App render PrintView (chỉ title + body render markdown, CSS A4, `@media print` ẩn root app) → onload setTimeout window.print(). Xuất PDF bằng hộp thoại Save-as-PDF của WebView2.
- [ ] Smoke: đính kèm 1 txt, link xuất hiện trong body + file trong attachments/; `?print=1` render trang in sạch.

### Task P3.3: Quick capture + tray

**Files:** Modify `tauri.conf.json` (window "quickcapture" hidden, 380×160, alwaysOnTop, skipTaskbar), `lib.rs` (tray TrayIconBuilder menu: Mở app/Quick capture/Quit; global-shortcut Ctrl+Shift+N toggle quickcapture; cleanup orphan lúc setup), Create `src/QuickCapture.tsx`; Modify `main.tsx` (route ?quick).

- [ ] QuickCapture: textarea 1 dòng, Enter → create note (title = dòng đầu, body = nội dung) → toast + ẩn window; Esc ẩn.
- [ ] Tray: icon từ icons/icon.ico, menu handler: open main (show+focus), quick capture (toggle), quit (exit).
- [ ] Smoke: Ctrl+Shift+N (khi app focus hoặc global) hiện cửa sổ nhỏ → gõ Enter → note mới trong list chính.

### Task P3.4: Verify Phase 3 + commit

- [ ] cargo test + npm test + npm run build pass; commit `phase-3: ...`.

---

## Phase 4 — MCP Server + Sync

### Task P4.1: notes-core sync + read offset (TDD)

**Files:** Create `crates/notes-core/src/sync.rs`; Modify `store.rs` (`read_body_range(id, char_offset, max_chars)`), `lib.rs`.

- [ ] `sync::mirror(notes_dir, target_dir) -> SyncReport{copied_out, copied_in, skipped}`: 2 chiều file .md; file chỉ có 1 phía → copy sang; 2 phía → so `updated` frontmatter, newer-wins; lỗi parse phía nào → phía parse được thắng. Test tempdir: 6 case (1 chiều out/in, newer thắng 2 chiều, lỗi parse, file mới target).
- [ ] `read_body_range` cho MCP read_note (offset/limit ký tự). Test.
- [ ] App wire: settings.syncFolder (plugin-store) → command `set_sync_folder(path)` → mirror ngay + watcher sync_dir → mirror khi đổi (thread riêng, debounce bằng watcher sẵn có).

### Task P4.2: MCP server binary (TDD)

**Files:** Create `crates/mcp-server/` (Cargo.toml bin `dnt-note-mcp`, `src/main.rs`, `src/protocol.rs` + test).

- [ ] protocol.rs: `handle_message(json, store) -> Option<Json>`: initialize → {protocolVersion "2024-11-05", capabilities:{tools:{}}, serverInfo}; tools/list → 7 tool schemas; tools/call (list_notes/search_notes/read_note{offset,limit}/create_note/update_note/delete_note/open_note→ URI `dntnote://note/<id>` trong text result); notifications → None; unknown → error -32601. Test: feed Value → assert response shape từng tool (tempdir store).
- [ ] main.rs: parse args `[notes_dir]` (default %APPDATA%), loop stdin line → handle → println stdout; watcher NotesWatcher để giữ store index fresh.
- [ ] Test e2e nhỏ: echo 3 dòng JSON vào module function (không spawn process — Windows pipe khó trong unit test).

### Task P4.3: Single-instance + deep-link + sync UI

**Files:** Modify `Cargo.toml` (+tauri-plugin-single-instance, tauri-plugin-deep-link), `lib.rs`, `tauri.conf.json` (deep-link scheme dntnote), `SettingsDialog.tsx` (DataSection: chọn sync folder), `App.tsx` (focus note từ deep link: listen sâu `deep-link://new-url` → parse id → select).

- [ ] single-instance: instance thứ 2 → focus cái chính (callback nhận argv → nếu chứa `dntnote://note/<id>` emit tới app).
- [ ] MCP registration docs: README mục "Dùng với AI client" — JSON config mẫu (command: path tới dnt-note-mcp.exe, args: notes dir).
- [ ] Verify: `cargo run -p dnt-note-mcp` thủ công: pipe 2 dòng initialize+tools/list qua stdin (PowerShell here-string) → nhận 2 dòng JSON đúng.

### Task P4.4: Final verify + release + README

- [ ] Toàn bộ test pass (cargo + vitest), `npm run build`, `npm run tauri build` NSIS xong.
- [ ] README cập nhật: tính năng Phase 2–4, cách cấu hình provider AI, MCP config, sync folder, phím tắt mới (Ctrl+Shift+N).
- [ ] Commit `phase-4: ...` + plan ticks.

## Self-review

1. **Spec coverage:** §5.2 tools 10 ✓ (P2.2), confirmation card ✓ (P2.3), @mention 8k ✓ (P2.3), multi-provider preset ✓ (P2.3), test connection ✓ (P2.2/P2.3), chat history ✓ (P2.1/P2.3); §5.3 10 file/25MB ✓ (P3.1), extract pdf/docx ✓, downscale 2048 ✓, export PDF print ✓, quick capture ✓, tray ✓, orphan cleanup ✓; §5.4 MCP 7 tools ✓ (P4.2), watcher 2 chiều ✓, sync newer-wins ✓, deep-link ✓.
2. **Placeholder scan:** không có TBD; mỗi task có file/interface/test cụ thể.
3. **Type consistency:** `ChatSession{id,title,messages,updated}` (P2.1 ↔ P2.3); `StoredFile{name,size}` (P3.1 ↔ api.ts); `SyncReport` (P4.1 ↔ command); tool names khớp spec §5.2.
