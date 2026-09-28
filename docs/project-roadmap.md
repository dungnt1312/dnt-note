# DNT Note — Lộ trình phát triển

> Cập nhật: 2026-09-27 · Branch hiện tại `feat/phases-5-7` (chưa merge vào main, working tree có thay đổi chưa commit)
> Liên quan: [project-overview-pdr](./project-overview-pdr.md) · [system-architecture](./system-architecture.md)
> Văn bản nguồn: specs & plans trong `docs/superpowers/` (không sửa trực tiếp — xem §6)

## 1. Tổng quan phase

| Phase | Nội dung | Trạng thái |
|---|---|---|
| **Phase 1** — Notes core | CRUD `.md` + frontmatter, NotesStore, trash/undo, search, tags, pin, live-preview editor, watcher, demo seed | ✅ Hoàn thành |
| **Phase 2** — AI assistant | Agent 10 tools, streaming SSE, multi-provider, chat sessions, safe delete | ✅ Hoàn thành |
| **Phase 3** — Attachments + Export + Quick capture + Tray | Đính kèm file, extract text, PDF export, cửa sổ quick capture `Ctrl+Shift+N`, tray | ✅ Hoàn thành |
| **Phase 4** — MCP server + Sync folder | Binary `dnt-note-mcp` (7 tools), sync mirror newer-wins | ✅ Hoàn thành |
| **Phase 5** — Quản lý media | Media library, render ảnh asset-protocol, drag/drop editor, chat vision, tools `list_media`/`read_attachment` | 🔶 Một phần — chỉ Task 1 (fix attachment refs + sync attachments + orphan grace) đã commit |
| **Phase 6** — Agent Skills | `skills/<name>/SKILL.md`, trigger `/`, settings UI, MCP tools | ⬜ Chưa bắt đầu |
| **Phase 7** — Mở rộng | Version history, wiki-links, semantic search, voice, keyring, AI suggestions, trash screen | ⬜ Chưa bắt đầu |

**Feature arcs ngoài phase (đã hoàn thành):**

| Arc | Văn bản | Kết quả |
|---|---|---|
| Composer refactor kiểu ZCode | [spec](./superpowers/specs/2026-09-27-composer-refactor-design.md) · [plan](./superpowers/plans/2026-09-27-composer-refactor.md) | Lexical composer: `@note` token atomic inline, attachment tray (paperclip/paste/drag-drop), safe send, retry gắn message, per-run abort, chat JSON có cấu trúc |
| Editor context menu → AI | [spec](./superpowers/specs/2026-09-27-editor-context-menu-to-ai-design.md) · [plan](./superpowers/plans/2026-09-27-editor-context-menu-to-ai.md) | Right-click trong editor → gửi selection (snippet) hoặc cả note (@note token) cho Assistant |

**Đang thực hiện:** Multimodal chat history ([spec](./superpowers/specs/2026-09-27-multimodal-chat-history-design.md) · [plan](./superpowers/plans/2026-09-27-multimodal-chat-history.md)) —
tái dựng ảnh/tài liệu/mention từ các turn user trước mỗi lượt follow-up và sau reload session;
persistence chỉ lưu tham chiếu; fallback `[Image/File unavailable]`.
Plan 3 tasks (RED tests → buildRequestHistory → verify); **uncommitted** trên working tree.

## 2. Phase 5 — Quản lý media (còn lại)

Spec: [2026-09-27-phases-5-7-media-skills-extras-design.md](./superpowers/specs/2026-09-27-phases-5-7-media-skills-extras-design.md)

| Hạng mục | Chi tiết |
|---|---|
| ✅ 5.0 Sửa lỗi nền (Task 1, đã commit `f1b4356`) | `refs_in_body` parse cân bằng ngoặc; quét refs cả `.trash/` + note hỏng frontmatter; sync mirror thêm `attachments/` |
| 5.1 Hiển thị ảnh | Bật asset protocol (scope `$APPDATA/.../attachments/**`); helper `attachmentUrl(name)` = `convertFileSrc`; CM6 widget ảnh block dưới dòng `![..]` khi không focus; PrintView + chat markdown `urlTransform` |
| 5.2 Thư viện media | `notes-core::media::list_media` → `MediaItem {name, kind, size, modified, usedBy}`; commands `list_media`, `rename_media`, `delete_media(force)`, `import_media`, `attachments_dir_path`; section UI `media` (tab thứ 3): lưới/danh sách, lọc loại, tìm tên, panel chi tiết (preview, "Dùng trong", đổi tên, chèn vào note, mở app ngoài, xóa) |
| 5.3 Đính kèm trong editor + chat | Editor: drag-drop & paste ảnh → `attach_bytes`/`attach_file`, chèn link **tại con trỏ**; chat composer đã có qua composer refactor (ảnh → `image_url`, file → extract ≤20k); agent tools mới `list_media`, `read_attachment` |
| Cleanup điều chỉnh | Chỉ xóa file không dùng quá 7 ngày (mtime) để thư viện có chỗ cho file vừa nhập |

## 3. Phase 6 — Agent Skills (chưa bắt đầu)

| Hạng mục | Chi tiết |
|---|---|
| Định dạng | Thư mục `%APPDATA%/com.dungnt.dntnote/skills/<name>/SKILL.md`, frontmatter `name`, `description` (+ `enabled`) |
| Rust | `notes-core::skills`: `list_skills`, `read_skill`, `save_skill`, `delete_skill`; seed 3 skill mẫu (`meeting-notes`, `weekly-review`, `flashcards`) từ `resources/skills/` |
| Progressive disclosure | System prompt chỉ liệt kê `name: description`; tool `load_skill(name)` trả toàn văn; user gõ `/tên` trong composer (autocomplete) → nạp nội dung vào lượt đó |
| UI | Mục "Skills" trong Cài đặt: danh sách, bật/tắt, tạo/sửa (textarea Markdown), xóa, mở thư mục |
| MCP | Thêm `list_skills`, `get_skill` cho client ngoài |

## 4. Phase 7 — Mở rộng (chưa bắt đầu)

| # | Tính năng | Điểm chính |
|---|---|---|
| 1 | Lịch sử phiên bản | Lưu bản cũ vào `notes/.history/<id>/<timestamp>.md` trước mỗi update có thay đổi body; gộp <5 phút (trừ agent/MCP — luôn lưu); giữ ≤50 bản; commands `list_versions`/`read_version`/`restore_version`; dialog xem & khôi phục |
| 2 | Wiki-links `[[Tiêu đề]]` + backlinks | Editor highlight + Ctrl+click mở note; autocomplete sau `[[`; `get_backlinks(id)`; panel "Liên kết ngược"; tool agent `get_backlinks` |
| 3 | Tìm kiếm ngữ nghĩa | `lib/semantic/`: embeddings qua `POST /embeddings` của provider (trường `embeddingModel`); index `embeddings.json`; cosine top-k; tool `semantic_search`; không có embeddingModel → lỗi thân thiện |
| 4 | Ghi âm + chuyển giọng nói | Nút mic → MediaRecorder (webm) → attachment audio; nếu provider có `transcriptionModel` gọi `/audio/transcriptions` (multipart) + chèn transcript |
| 5 | API key an toàn | Crate `keyring`: `secret_set/get/delete`; `providers.json` lưu `apiKey: ""` + `keyInVault: true`; migrate key cũ lần đầu load |
| 6 | Nhỏ | AI gợi ý tiêu đề & tags (menu note); màn hình Thùng rác trong Cài đặt → Dữ liệu (liệt kê, khôi phục, xóa vĩnh viễn) + `list_trash`, `purge_trash_item` |

## 5. Sau Phase 7 (ý tưởng, chưa có spec)

- Chưa có văn bản thiết kế — mọi mục ở đây là khả năng mở rộng, cần spec riêng trước khi làm.
- Ứng viên tự nhiên: đa nền tảng macOS/Linux (Tauri 2 hỗ trợ), nhiều vault/thư mục notes,
  plugin hệ thống. **Cần xác minh** với product owner trước khi đưa vào kế hoạch.

## 6. Quy trình và văn bản

- Spec/plan quản lý trong `docs/superpowers/specs/` và `docs/superpowers/plans/`
  (đặt tên `YYYY-MM-DD-<tên>-design.md` / `-<tên>.md`); research trong `docs/research/`.
- Quy ước test/commit khi làm phase: mỗi module Rust mới có unit test; TS có vitest cho logic
  thuần; command trả `Result<_, String>` + UI toast; commit theo phase
  (`phase-5: ...`, `phase-6: ...`, `phase-7: ...`) — chi tiết [code-standards](./code-standards.md).
- **Ràng buộc hiện hành:** không commit trừ khi user yêu cầu (plan multimodal-chat-history ghi rõ);
  docs tài liệu này không đụng vào `docs/superpowers/` và `docs/research/`.
- Git arcs gần nhất: phases 5–7 kickoff (`274ed0a` docs, `f1b4356` phase-5 fixes,
  `5f677c4` model picker multi-model) → composer refactor arc (`ba32316`→`9029aec`) →
  editor right-click arc (`a734897`→`784e5b1` HEAD).
