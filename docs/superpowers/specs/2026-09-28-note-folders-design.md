# DNT Note — Thư mục ghi chú (Design Spec)

Ngày: 2026-09-28 · Trạng thái: Tự động chốt phương án đề xuất (user không phản hồi câu hỏi làm rõ — chọn phương án A, folder 1 cấp)

## Mục tiêu

Thêm **thư mục 1 cấp** (không lồng nhau) để tổ chức ghi chú: tạo / đổi tên / xoá thư mục, chuyển ghi chú vào – ra thư mục, lọc danh sách sidebar theo thư mục. Thông tin thư mục đi kèm ghi chú qua frontmatter nên **sync mirror OneDrive/Drive và watcher hoạt động không đổi**.

## Hướng đã cân nhắc

- **A — chọn:** folder là trường frontmatter trên note + file đăng ký `folders.json`. Notes vẫn là file phẳng trong `notes/`; `store.reload()`, watcher (non-recursive), sync mirror, search không phải sửa gì. Folder info đi theo file .md khi sync.
- B — loại: thư mục con thật trên đĩa (`notes/<folder>/<id>.md`). Phải đổi reload đệ quy, watcher recursive, sync mirror lồng thư mục, id uniqueness — rủi ro lớn với sync hiện có.
- C — loại: folder là tag đặc biệt. Nhập lẫn concept tag, chip tag bị nhiễm, không có ngữ nghĩa riêng (xoá folder ≠ xoá tag).

## Mô hình dữ liệu

- Rust: `Note`/`NoteMeta`/`Note` frontmatter thêm `folder: Option<String>` (`None` = ngoài thư mục, "root"). `NotePatch` **không đổi** — folder không sửa qua `update_note`.
  - `note_file.rs::Frontmatter` thêm `folder` với `#[serde(default, skip_serializing_if = "Option::is_none")]` — note chưa gán thư mục serialize ra file giữ nguyên dạng cũ (không có `folder: null`); file cũ thiếu field vẫn parse bình thường.
- TS: `NoteMeta` thêm `folder: string | null`. `NotePatchDto` không đổi.
- Đăng ký thư mục: `folders.json` ở **appData root** (mảng tên, viết bằng `write_atomic`). Lý do phải có registry: folder rỗng (chưa có note) vẫn phải tồn tại. Danh sách hiển thị = **union(registry, các giá trị `folder` của notes)** để note sync từ máy khác về vẫn hiện đúng thư mục dù registry máy này chưa có tên đó.

## Backend (notes-core)

- Module mới `folders.rs`: `FolderRegistry { path: PathBuf, names: Vec<String> }` — load JSON khi khởi tạo, save mỗi lần đổi. Validate tên: trim, 1–80 ký tự, duy nhất (so sánh bằng `to_lowercase()` — Unicode, phủ cả tiếng Việt — trong union registry + notes).
- **So khớp tên thư mục trên note là case-insensitive** (`to_lowercase()`): note có `folder: "Work"` vẫn thuộc registry `"work"`. Danh sách hiển thị dùng tên chuẩn từ union.
- `NotesStore` giữ `folders: FolderRegistry`; `NotesStore::new(notes_dir, folders_path)` (call sites hiện có sửa kèm).
- Methods mới:
  - `list_folders(&self) -> Vec<String>` — union, sort theo lowercase, trả tên đã trim.
  - `create_folder(&mut self, name: &str) -> Result<Vec<String>>` — validate, thêm registry, trả danh sách mới.
  - `rename_folder(&mut self, old: &str, new: &str) -> Result<usize>` — validate; registry: bỏ `old` thêm `new`; mọi note khớp `old` case-insensitive được ghi lại với `folder = new`. Trả số note đã đổi.
  - `remove_folder(&mut self, name: &str) -> Result<usize>` — bỏ khỏi registry; mọi note có folder đó → `folder = None`. Trả số note.
  - `set_note_folder(&mut self, id: &str, folder: Option<&str>) -> Result<Note>` — `Some(f)` phải tồn tại trong union (khớp case-insensitive; ghi lại tên chuẩn của union); cập nhật `updated`.
  - **Cả ba operation trên ghi đổi folder vào note file đều bump `updated`** (kể cả rename/remove hàng loạt). Bắt buộc: sync mirror quyết định bằng `updated`, hai file khác nội dung nhưng tie timestamp thì bỏ qua cả hai (`sync.rs::pick_winner` → `Side::Tie`) — không bump thì rename không bao giờ kéo sang cloud. Hệ quả chấp nhận được: các note trong thư mục nhảy lên đầu danh sách (sort theo `updated` desc) sau khi rename/xoá thư mục.
  - `create(...)` thêm tham số `folder: Option<String>` (call site `seed_demo_notes` truyền `None`).
- Lỗi trả `NoteError` → command map thành `folder-error: …`/`note-error: …` (chuỗi, nhất quán hiện có).

## Tauri commands (`src-tauri/src/commands/notes.rs`, đăng ký trong `lib.rs`)

- `list_folders() -> Vec<String>`
- `create_folder(name) -> Vec<String>`
- `rename_folder(old, new) -> { folders: Vec<String>, moved: usize }`
- `delete_folder(name) -> { folders: Vec<String>, moved: usize }`
- `move_note_to_folder(id, folder: Option<String>) -> Note`

## Frontend

- **api** (`src/lib/api/notes.ts`): `NoteMeta.folder: string | null`; `api.folders = { list, create, rename, del }`; `api.notes.moveToFolder(id, folder | null)`.
- **notesStore**: state `folders: string[]`; actions `loadFolders`, `createFolder(name)` (validate client-side 1–80, toast lỗi nếu trùng), `renameFolder(old, new)`, `deleteFolder(name)` (toast "Đã xoá thư mục, N ghi chú về root"), `moveNoteToFolder(id, folder | null)` (optimistic map notes + toast kèm **Undo** dùng folder cũ — đúng pattern `useDeleteNote`).
- **uiStore**: `folderFilter: string | null`, `setFolderFilter` — hoạt động song song với `tagFilter` (AND).
- **Sidebar — `NotesPane`**: thêm `FolderSection` (component mới `src/components/notes/FolderSection.tsx`) dưới `SearchField`, trên `TagFilterRow`:
  - Header: label "Thư mục" + `IconButton` `+` → chèn hàng inline-input (autoFocus; Enter tạo, Escape huỷ, blur tạo nếu tên hợp lệ — pattern rename chat).
  - Rows: icon `Folder` + tên + count (đếm client-side từ `notes`). Click → chọn lọc (`folderFilter`); click lần nữa → bỏ lọc. `SidebarRow` + hover-reveal `Menu` (…): "Đổi tên" (inline input), "Xoá thư mục" (`ConfirmDialog`: "Xoá thư mục «X»? N ghi chú sẽ về danh sách chung. Ghi chú không bị xoá.").
  - Section ẩn khi không có folder và chưa bắt đầu tạo.
  - Filter áp vào `visible = notes.filter(folder).filter(tag)` trước khi truyền vào `NoteList` (search lọc sâu hơn trong NoteList như cũ).
- **`MoveNoteDialog`** (component mới, dựng trên `Overlay`): danh sách nút radio các thư mục + hàng "Không có thư mục"; chọn → gọi `moveNoteToFolder` + đóng.
- **`NoteItem`**: thêm `MenuItem` "Chuyển tới thư mục…" (icon `FolderInput`) sau Pin, trước Delete, mở `MoveNoteDialog` (prop `onMove` mới của `NoteItem`/`NoteList`).
- **i18n** (`src/i18n/sidebar.ts` + keys mới, vi/en song song): `sidebar.folders`, `sidebar.newFolder`, `sidebar.folderName`, `sidebar.moveToFolder`, `sidebar.noFolder`, `sidebar.deleteFolderTitle`, `sidebar.deleteFolderDesc`, `sidebar.folderCreated`, `sidebar.folderDeleted`, `sidebar.movedToFolder`… (assert tiếng Việt trong test — `vitest.setup.ts` pin `vi`).

## Xử lý lỗi

- Tên rỗng/quá dài/trùng → không gọi API, toast lỗi nội bộ.
- Lỗi backend → `console.error` + toast `folder-error: …` (không crash UI).
- Xoá/đổi tên thư mục đang được chọn lọc → clear `folderFilter` nếu tên đó biến mất.

## Phạm vi ngoài (YAGNI)

Không lồng thư mục; không drag-drop note vào folder; không icon/màu tuỳ chỉnh; không lệnh palette "Tạo thư mục"; không đếm count phía backend.

## Kiểm thử

- **Rust** (inline `#[cfg(test)]`): round-trip frontmatter (Some/None/thiếu field); registry CRUD, persist qua reopen store; rename/remove cập nhật đúng notes + bump `updated`; validate tên trùng (case-insensitive)/rỗng; `set_note_folder` với folder không tồn tại → lỗi.
- **Vitest**: `notesStore.test.ts` — actions folders (optimistic, undo data, toast), filter folder+tag; `FolderSection.test.tsx` — render/tạo inline/đổi tên/xoá/chọn lọc; `MoveNoteDialog.test.tsx`; `NoteList.test.tsx` — thêm case menu chuyển thư mục.
- Chạy: `npm test`, `cargo test` (trong `src-tauri/`).
