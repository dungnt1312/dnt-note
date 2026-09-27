# DNT Note — Chuột phải trong editor: "Gửi vào Trợ lý AI" (Design Spec)

Ngày: 2026-09-27 · Trạng thái: Đã duyệt (user chốt hướng "đính kèm vào chat, user tự prompt")

## Mục tiêu

Chuột phải vào vùng soạn thảo note → menu ngữ cảnh tại con trỏ → đưa ngữ cảnh (đoạn đang chọn hoặc cả note) vào panel Trợ lý AI đang có. **Không định nghĩa sẵn action AI nào** (review/đề xuất/dịch…): sau khi ngữ cảnh được đính kèm, người dùng tự gõ prompt tuỳ ý và gửi. Streaming, agent, tools, persistence, abort — tái dùng 100% cơ chế chat hiện có, không đụng backend.

## Hành vi

- **Có selection** → menu: `Gửi vào Trợ lý AI` + `Sao chép`.
  - "Gửi vào Trợ lý AI": đoạn chọn thành **attachment ảo** (chip trong AttachmentTray), mở ChatPanel docked nếu chưa mở, focus ô nhập. Không tự gửi.
  - "Sao chép": copy đoạn chọn (bù cho menu native vừa bị chặn).
- **Không có selection** → menu: `Hỏi AI về ghi chú này`.
  - Mở chat (nếu chưa mở) + chèn token `@«tên note»` (ContextTokenNode) vào composer + focus. Body note đi vào context qua cơ chế mention có sẵn (budget 8k/note).
- Chuột phải **luôn `preventDefault()`** trong vùng editor để chặn menu native của WebView2.
- Nếu note rỗng (body trống, không selection) → mục "Hỏi AI về ghi chú này" vẫn cho dùng (token note rỗng vô hại).

## Kiến trúc

### Mới — `src/components/ui/ContextMenu.tsx`

Menu portal `position: fixed` tại `{x, y}` (clamp vào viewport). Tái dùng `MenuItem`/`MenuSeparator`/`MenuLabel` từ `ui/Menu.tsx` qua chung `MenuContext` — export `MenuContext` từ `ui/Menu.tsx` để `ContextMenu` provide. Giữ behavior của `Menu`: click-outside/Esc đóng, ↑↓ di chuyển item, focus item đầu khi mở. Lý do không dùng lại `Menu`: nó anchor `absolute` vào trigger wrapper, không neo theo tọa độ chuột.

### Mới — `src/components/notes/EditorContextMenu.tsx`

Component nhận `{x, y, hasSelection, onSelection, onWholeNote, onClose}`; render `ContextMenu` bên trong và nấu item theo ngữ cảnh (selection: "Gửi vào Trợ lý AI" + "Sao chép"; không selection: "Hỏi AI về ghi chú này"), gọi action rồi đóng.

### Sửa — `NoteEditor.tsx`

- `onContextMenu` trên div bọc `editorHost`: đọc `view.state.selection.main` (chuột phải không xoá selection nên range luôn đúng), `preventDefault()`, set state `{x, y, hasSelection}` → render `ContextMenu`.
- Logic đọc selection tách hàm thuần `getSelectionInfo(state: EditorState)` (đặt `src/lib/editor/selection.ts`): trả `{from, to, text, hasSelection}` — test được không cần mount.

### Sửa — `src/lib/store/composerStore.ts`

- Action `addSnippet(chatId, { originalName, text })`: đẩy thẳng `DraftAttachment { id, name: "", originalName, size: text.length, kind: "document", status: "ready", text }` — **không ghi file, không qua import**. Gửi đi được ngay vì `buildRequestUserMessage` chỉ cần `originalName` + `text` (block `[File: …]`). Text clip ở `MAX_DOC_CHARS` (20k) giống đường document hiện có. Persist bình thường qua `stripForPersist`.
- Kênh bơm ngữ cảnh NoteEditor → Composer (2 cây anh em): `pendingContext: { kind: "snippet", title, text } | { kind: "note", noteId, title } | null` + `pushChatContext()` / `takeChatContext()`.

### Sửa — `Composer.tsx`

- Effect theo dõi `pendingContext`: khi có → consume: `snippet` → `addSnippet(chatId, …)`; `note` → chèn `ContextTokenNode` vào Lexical editor (tại caret nếu có selection, ngược lại append cuối) rồi focus; clear pending. Dùng `$createContextTokenNode` có sẵn; phần chèn-at-end viết helper nhỏ cạnh `insertNoteTokenAtCaret` (file `ContextTokenNode.tsx`) vì `insertNoteTokenAtCaret` đòi collapsed selection.

## Xử lý lỗi / edge cases

- Chat đang `streaming`: snippet vẫn vào khay (giống thả file hiện nay); gửi khi xong (nút send đã disable sẵn).
- Chưa cấu hình provider: menu không chặn — lỗi hiện tại banner error của chat khi gửi (hành vi sẵn có).
- Chat đang mở sẵn: pendingContext được consume ngay (effect chạy cả khi Composer đã mount).
- Section "chat" toàn màn hình: NoteEditor không hiển thị → không xảy ra.
- Selection chỉ toàn khoảng trắng: vẫn coi là selection (text rỗng sau trim thì attachment ảo text rỗng → gửi kèm block `[File]` rỗng — chấp nhận, hiếm gặp).

## Testing (vitest, theo convention)

- `composerStore.test.ts`: `addSnippet` → attachment ready + shape đúng; `pendingContext` push/take; `stripForPersist` giữ snippet.
- `selection.ts`: có/không selection, text khớp `sliceDoc`.
- `ContextMenu.test.tsx`: render tại tọa độ, Esc/click-outside đóng, item gọi callback.
- `Composer.test.tsx` (mock store): pending snippet → chip trong tray; pending note → text editor chứa `@title`.

## Ngoài phạm vi (làm sau nếu cần)

Action định nghĩa sẵn (review/đề xuất/tóm tắt…), thẻ "Áp dụng vào note" trong chat, snippet-token kiểu mới cho ContextTokenNode, chặn menu native ngoài vùng editor (sidebar, chat…).
