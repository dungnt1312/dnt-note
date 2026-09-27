# DNT Note — Phase 5–7: Media, Agent Skills, mở rộng (Design Spec)

Ngày: 2026-09-27 · Trạng thái: Đã duyệt (user chốt theo đề xuất, không hỏi lại)

## Phase 5 — Quản lý media

### 5.0 Sửa lỗi nền (bắt buộc trước)
1. `refs_in_body` phải parse đúng tên có ngoặc: tìm `(attachments/` rồi lấy tới `)` **khớp cân bằng ngoặc** (đếm `(`/`)` lồng nhau), dừng ở xuống dòng. `image (1).png` → đúng tên.
2. `attachment_refs` quét cả `.trash/` và file note lỗi frontmatter (đọc raw text) → không xoá file của note trong thùng rác.
3. Sync folder mirror thêm `attachments/` (một chiều theo tên: thiếu bên nào copy sang bên đó; tên có uuid nên không xung đột). Thư mục đích: `<sync>/attachments/`.

### 5.1 Hiển thị ảnh
- Bật asset protocol Tauri (`app.security.assetProtocol` scope `$APPDATA/com.dungnt.dntnote/attachments/**`).
- Frontend helper `attachmentUrl(name)` = `convertFileSrc(<attachmentsDir>/<name>)`; ngoài Tauri trả chuỗi rỗng.
- Editor CM6: widget ảnh dạng block dưới dòng `![..](attachments/x)` khi dòng không focus (max-width 100%, max-height 360px).
- PrintView + chat markdown: `urlTransform` đổi `attachments/x` → asset URL.

### 5.2 Thư viện media
- Rust `notes-core::media::list_media(attachments_dir, store)` → `MediaItem { name, displayName, ext, kind: image|document|audio|other, size, modified, usedBy: [{id,title}] }`.
- Commands: `list_media`, `rename_media(name, newDisplayName)` (giữ tiền tố uuid, cập nhật mọi link trong note), `delete_media(name, force)` (từ chối nếu đang dùng trừ khi force; khi force gỡ link khỏi note), `import_media(srcPath)` (lưu không gắn note), `attachments_dir_path`.
- Section UI mới `media` (Ctrl+3, tab thứ 3 ở WorkspaceSwitcher): lưới ảnh/danh sách file, lọc theo loại (Tất cả/Ảnh/Tài liệu/Âm thanh/Chưa dùng), tìm theo tên, panel chi tiết: xem trước, kích thước, "Dùng trong" (click mở note), Đổi tên, Chèn vào note đang mở, Mở bằng app ngoài, Xoá (xác nhận). Nút "Nhập tệp…".
- Cleanup lúc khởi động giữ nguyên nhưng **chỉ xoá file không dùng quá 7 ngày** (theo mtime) để thư viện có chỗ cho file vừa nhập.

### 5.3 Đính kèm trong editor và chat
- Editor: kéo-thả file & dán ảnh (clipboard) → Rust command `attach_bytes(noteId, fileName, base64)` / `attach_file`, chèn link **tại con trỏ** (không append cuối).
- Chat composer: nút 📎 + kéo-thả + dán. Ảnh → `prepare_attachment_image` → message content dạng mảng OpenAI `[{type:"text"},{type:"image_url"}]`. File tài liệu → `extract_attachment_text` (≤20k ký tự) chèn vào context giống mention. Chip hiển thị trong composer & tin nhắn. `ChatMessage.content` mở rộng thành `string | ContentPart[] | null`.
- Agent tools mới: `list_media`, `read_attachment` (trích text tài liệu theo tên).

## Phase 6 — Agent Skills
- Định dạng chuẩn Agent Skills: thư mục `skills/<name>/SKILL.md` với frontmatter `name`, `description` (+ tuỳ chọn `enabled`). Vị trí: `%APPDATA%/com.dungnt.dntnote/skills/`.
- Rust `notes-core::skills`: `list_skills`, `read_skill`, `save_skill`, `delete_skill`, parse frontmatter; seed 3 skill mẫu lần đầu (`meeting-notes`, `weekly-review`, `flashcards`) từ `resources/skills/`.
- Progressive disclosure: system prompt liệt kê `name: description` của skill đang bật; tool `load_skill(name)` trả toàn văn. Người dùng gõ `/tên` trong composer (autocomplete) → nội dung skill được nạp sẵn vào lượt đó.
- UI: mục "Skills" trong Cài đặt: danh sách, bật/tắt, tạo/sửa (textarea Markdown), xoá, mở thư mục.
- MCP: thêm `list_skills`, `get_skill` cho client ngoài.

## Phase 7 — Mở rộng
1. **Lịch sử phiên bản:** trước mỗi update có thay đổi body, lưu bản cũ vào `notes/.history/<id>/<timestamp>.md`, gộp: không tạo bản mới nếu bản gần nhất < 5 phút **trừ khi** thay đổi đến từ agent/MCP (luôn lưu). Giữ tối đa 50 bản/note. Commands `list_versions`, `read_version`, `restore_version`. UI: menu note → "Lịch sử phiên bản…" dialog xem & khôi phục.
2. **Wiki-links `[[Tiêu đề]]` + backlinks:** editor highlight + Ctrl+click mở note (khớp title không phân biệt hoa thường); autocomplete sau `[[`; `get_backlinks(id)` trong store; panel "Liên kết ngược" cuối editor. Tool agent `get_backlinks`.
3. **Tìm kiếm ngữ nghĩa:** `lib/semantic/` — embeddings qua `POST /embeddings` của provider (model cấu hình trong provider, trường `embeddingModel` tuỳ chọn); index JSON `embeddings.json` (id, updated, vector) tính lại khi `updated` đổi; cosine top-k. Tool agent `semantic_search`. Không có embeddingModel → tool báo lỗi thân thiện.
4. **Ghi âm + chuyển giọng nói:** nút mic trong editor → MediaRecorder (webm) → lưu làm attachment audio → nếu provider có `transcriptionModel` gọi `/audio/transcriptions` (multipart) và chèn transcript dưới link. Audio phát được trong thư viện media.
5. **API key an toàn:** Rust crate `keyring` — commands `secret_set/get/delete`; providers.json lưu `apiKey: ""` + cờ `keyInVault: true`; migrate key cũ lần đầu load.
6. **Nhỏ:** AI gợi ý tiêu đề & tags (menu note → "Gợi ý tiêu đề & thẻ"); màn hình Thùng rác trong Cài đặt → Dữ liệu (liệt kê, khôi phục, xoá vĩnh viễn từng note) với commands `list_trash`, `purge_trash_item`.

## Kiến trúc & quy ước
- Logic thuần ở `notes-core` (test tempdir); commands mỏng ở `src-tauri/src/commands/<area>.rs`; API TS ở `src/lib/api/`; UI theo token/component có sẵn.
- Test: mỗi module Rust mới có unit test; TS có vitest cho parser/logic thuần (skills frontmatter, wiki-link parse, cosine, content parts).
- Lỗi: command trả `Result<_, String>`; UI toast.
- Commit theo phase: `phase-5: ...`, `phase-6: ...`, `phase-7: ...`.
