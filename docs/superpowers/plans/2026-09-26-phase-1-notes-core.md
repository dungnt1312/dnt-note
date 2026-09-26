# DNT Note — Phase 1 (Notes Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App ghi chú Windows (Tauri 2 + React) hoàn chỉnh phần notes core: CRUD file .md + frontmatter, search, editor CodeMirror 6 live-preview kiểu Obsidian, tags/pin/trash+undo, command palette, theme, demo notes.

**Architecture:** Hybrid — notes-core là Rust lib thuần (model/parse/store/watcher, có unit test); Tauri app crate bọc commands mỏng; React UI + zustand; agent/AI để Phase 2. Workspace Cargo: `src-tauri` (app) + `src-tauri/crates/notes-core`.

**Tech Stack:** Tauri 2, React 19 + TS + Vite + Tailwind 4, zustand, CodeMirror 6 + @lezer/markdown, vitest; Rust: serde, serde_yaml 0.9, uuid v4, chrono, notify + notify-debouncer-full, tauri-plugin-store, tauri-plugin-opener.

## Global Constraints

- Tên app "DNT Note", identifier `com.dungnt.dntnote`, window title "DNT Note".
- Lưu notes: `%APPDATA%/com.dungnt.dntnote/notes/<uuid>.md`, frontmatter YAML: `id, title, tags, pinned, created, updated` (ISO 8601, UTC). Ghi file atomic (`.tmp` + rename). Xóa → `notes/.trash/`.
- Timestamps Rust type `DateTime<Utc>` (chrono), serialize ISO string camelCase qua serde (`rename_all = "camelCase"`).
- Autosave debounce 600ms; watcher debounce 300ms; event tên `notes://changed`.
- Theme tokens: typography scale 11–28px, contrast secondary ≥4.5:1, light/dark qua CSS variables + class `dark` trên `<html>`.
- Windows-first: shortcut dùng Ctrl (Ctrl+N/P/F/S/K, Ctrl+Shift+N để Phase 3).
- Mỗi task: test trước (nơi test được), chạy pass rồi mới commit. Commit prefix `phase-1: `.
- Frontmatter schema cố định 6 trường — KHÔNG thêm trường tự nhiên; mở rộng phải sửa cả parse lẫn serialize kèm test.

---

### Task 1: Scaffold workspace (Vite + Tauri 2 + Tailwind 4 + vitest + Cargo workspace)

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/vite-env.d.ts`, `vitest.config.ts`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/crates/notes-core/Cargo.toml`, `src-tauri/crates/notes-core/src/lib.rs`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: app chạy được `npm run dev` (Vite), `npm run tauri dev` (cửa sổ DNT Note), `cargo test` trong workspace, `npm test` (vitest). `src-tauri/src/lib.rs` export `run()` với plugin store + opener; `notes-core` lib rỗng (Task 2 lấp đầy).

- [ ] **Step 1: Tạo package.json + cấu hình frontend**

```json
{
  "name": "dnt-note",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.9.0",
    "@tauri-apps/plugin-opener": "^2.5.0",
    "@tauri-apps/plugin-store": "^2.4.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.3.1",
    "lucide-react": "^0.545.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "zustand": "^5.0.8"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.9.0",
    "@tailwindcss/vite": "^4.1.0",
    "@testing-library/jest-dom": "^6.9.0",
    "@testing-library/react": "^16.3.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^5.1.0",
    "jsdom": "^27.0.0",
    "tailwindcss": "^4.1.0",
    "typescript": "^5.9.0",
    "vite": "^7.1.0",
    "vitest": "^3.2.0"
  }
}
```

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: "es2022" },
});
```

`vitest.config.ts`: dùng môi trường jsdom, setupFiles `./vitest.setup.ts` (import "@testing-library/jest-dom/vitest"), plugin react. `tsconfig.json`: target ES2022, jsx react-jsx, strict, paths không cần. `index.html`: title "DNT Note", div#root, script src /src/main.tsx. `src/main.tsx` mount App. `src/index.css`: `@import "tailwindcss";`. `src/App.tsx`: trả `<div className="p-4">DNT Note</div>`. `.gitignore` thêm: `dist/`, `src-tauri/target/`, `src-tauri/gen/`.

- [ ] **Step 2: Tạo Cargo workspace + tauri.conf.json**

`src-tauri/Cargo.toml` (workspace root + app package chung 1 file):

```toml
[workspace]
members = [".", "crates/notes-core"]
resolver = "2"

[package]
name = "dnt-note"
version = "0.1.0"
edition = "2021"

[lib]
name = "dnt_note_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-store = "2"
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
notes-core = { path = "crates/notes-core" }
```

`crates/notes-core/Cargo.toml`:

```toml
[package]
name = "notes-core"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml = "0.9"
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
thiserror = "2"
```

(notify/notify-debouncer-full thêm ở Task 4.) `crates/notes-core/src/lib.rs`: `pub mod` placeholders rỗng — chỉ `// filled in Task 2`. `src-tauri/src/main.rs`: `fn main() { dnt_note_lib::run() }`. `src-tauri/src/lib.rs`:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`tauri.conf.json` (quan trọng — identifier, window, frontend path):

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "DNT Note",
  "version": "0.1.0",
  "identifier": "com.dungnt.dntnote",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "DNT Note",
        "width": 1280,
        "height": 800,
        "minWidth": 860,
        "minHeight": 560,
        "decorations": false,
        "center": true
      }
    ],
    "security": { "csp": null }
  },
  "bundle": { "active": true, "targets": ["nsis"], "icon": ["icons/icon.ico"] }
}
```

`src-tauri/build.rs`: `fn main() { tauri_build::build() }`. Icons: chạy `npx tauri icon` với 1 PNG mặc định (tạo PNG 1024 bằng script node canvas? — đơn giản nhất: dùng icon mặc định của template `npm create tauri-app`; nếu không có, generate `icons/icon.ico` từ 1 PNG thuần màu viết bằng hex. Chấp nhận icon đơn giản Phase 1).

- [ ] **Step 3: Cài deps + kiểm chứng build**

Run: `npm install`, rồi `cargo check` trong `src-tauri/` (lần đầu tải crate ~vài phút), rồi `npm test` (vitest không test nào = pass), `npm run build`.
Expected: không lỗi. Nếu `cargo check` lỗi icon/tauri.conf — sửa theo message.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "phase-1: scaffold Tauri 2 + React workspace"
```

---

### Task 2: notes-core — Note model + frontmatter round-trip (TDD)

**Files:**
- Create: `src-tauri/crates/notes-core/src/note.rs`, `src-tauri/crates/notes-core/src/note_file.rs`, `src-tauri/crates/notes-core/src/error.rs`
- Modify: `src-tauri/crates/notes-core/src/lib.rs`
- Test: tests nằm trong từng file `#[cfg(test)] mod tests`

**Interfaces:**
- Produces (Task 3+ dùng):
  - `Note { id: String, title: String, tags: Vec<String>, pinned: bool, created: DateTime<Utc>, updated: DateTime<Utc>, body: String }` (serde camelCase)
  - `NoteMeta` = Note không có body, thêm `snippet: String`, `word_count: u32`
  - `NoteError { Io, Yaml(String), MissingId, Unknown(String) }` (thiserror)
  - `note_file::parse(contents: &str) -> Result<Note, NoteError>` (id/file-name mismatch do store kiểm)
  - `note_file::serialize(note: &Note) -> String`

- [ ] **Step 1: Viết test round-trip failing**

`note_file.rs` tests (viết trước, `parse`/`serialize` chưa tồn tại → compile fail):

```rust
fn sample_note() -> Note { /* id "a1", title "Ghi chú: tiếng Việt", tags ["work", "a:b"], body "line1\n\n---\n\nline2" */ }
#[test] round_trip_preserves_all_fields();
#[test] parses_minimal_frontmatter();          // thiếu tags/pinned → default [], false
#[test] rejects_missing_id();
#[test] body_with_dashes_survives();           // body chứa "---" không bị cắt nhầm
#[test] crlf_input_normalized();               // \r\n → \n
#[test] unicode_title_tag_round_trip();
#[test] serialize_omits_unknown_frontmatter(); // YAML lạ bị bỏ khi serialize lại
```

- [ ] **Step 2: Chạy test fail**

Run: `cd src-tauri && cargo test -p notes-core`
Expected: compile error (không có hàm parse/serialize).

- [ ] **Step 3: Implement parse/serialize**

Chiến lược: tách frontmatter thủ công — nội dung bắt đầu `---\n`, tìm dòng `---`/`...` kế tiếp (cột 0) để lấy khối YAML, body = phần còn lại (normalize `\r\n`→`\n` trước). Parse YAML bằng `serde_yaml::from_str::<Frontmatter>` với struct:

```rust
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Frontmatter { id: String, title: String, tags: Vec<String>, pinned: bool, created: Option<DateTime<Utc>>, updated: Option<DateTime<Utc>> }
```

Serialize: `serde_yaml::to_string(&Frontmatter{...})` → ghép `---\n{yaml}---\n{body}` (đảm bảo yaml kết thúc `\n`). created/updated None → `Utc::now()`. `title` rỗng → "Untitled". `snippet` = 140 ký tự đầu body (strip `#*`-[] prefix chars, collapse whitespace).

- [ ] **Step 4: Chạy test pass**

Run: `cargo test -p notes-core` → 7 test PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "phase-1: notes-core note model + frontmatter round-trip"`

---

### Task 3: notes-core — NotesStore CRUD/search/tags/stats (TDD)

**Files:**
- Create: `src-tauri/crates/notes-core/src/store.rs`
- Modify: `src-tauri/crates/notes-core/src/lib.rs` (thêm `pub mod store;`)

**Interfaces:**
- Consumes: `Note`, `NoteMeta`, `note_file::{parse, serialize}`, `NoteError` (Task 2)
- Produces (Task 5 commands + Task 4 watcher + tương lai MCP dùng):
  - `NotesStore::new(notes_dir: PathBuf) -> io::Result<Self>` (tạo dir + .trash nếu thiếu)
  - `list() -> Vec<NoteMeta>` (pinned trước, rồi updated desc)
  - `read(id) -> Result<Note, NoteError>`; `create(title, body, tags) -> Result<Note, NoteError>`
  - `update(id, patch: NotePatch) -> Result<Note, NoteError>`; `NotePatch { title: Option<String>, body: Option<String>, tags: Option<Vec<String>>, pinned: Option<bool> }` (đặt updated = now)
  - `delete(id) -> Result<(), NoteError>` (move sang .trash, overwrite nếu trùng); `restore(id) -> Result<Note, NoteError>` (move ngược, updated=now)
  - `search(query: &str, limit: usize) -> Vec<NoteMeta>` (lowercase contains title+body; match title điểm cao hơn — sort title-match trước)
  - `tags() -> Vec<(String, usize)>` (đếm theo note chưa xóa, sort alpha)
  - `stats() -> Stats { total: usize, pinned: usize, words: u64, tags: usize }`
  - `reload()` — rebuild index (watcher gọi); store giữ `HashMap<String, NoteMeta>` in-memory + `changed_ids: Vec<String>` từ watcher merge vào.

- [ ] **Step 1: Viết test failing** — `mod tests` với tempdir (`tempfile` dev-dep thêm vào notes-core):

```rust
#[test] create_and_list_roundtrip();      // create → list có meta, snippet đúng, read đủ body
#[test] update_changes_fields_and_timestamp(); // updated tăng, created giữ
#[test] delete_moves_to_trash_and_restore();
#[test] search_matches_title_and_body_case_insensitive(); // "việt" khớp "Tiếng Việt"
#[test] search_ranks_title_above_body();
#[test] list_orders_pinned_first_then_updated_desc();
#[test] tags_counts_and_stats();
#[test] corrupt_file_listed_with_fallback_title(); // file yaml lỗi: title = "⚠ <tên file>"
#[test] reload_picks_up_external_changes(); // ghi đè file ngoài store → reload → read thấy
```

- [ ] **Step 2: Chạy fail** (`cargo test -p notes-core` → compile error).
- [ ] **Step 3: Implement** — `create` dùng `uuid::new_v4()`, created/updated = now, id trùng (hiếm) → regenerate. Ghi atomic: `fs::write(tmp)` + `fs::rename`. `update`: read + apply patch + serialize + write. `list/search/tags/stats` đọc qua index (rebuild khi init, gọi `reload()` khi watcher báo).
- [ ] **Step 4: Chạy pass** — `cargo test -p notes-core` → tất cả PASS.
- [ ] **Step 5: Commit** — `phase-1: notes-core NotesStore CRUD/search/tags/stats`

---

### Task 4: notes-core — File watcher

**Files:**
- Modify: `src-tauri/crates/notes-core/Cargo.toml` (+ `notify = "8"`, `notify-debouncer-full = "0.5"`)
- Create: `src-tauri/crates/notes-core/src/watcher.rs`

**Interfaces:**
- Produces: `NotesWatcher::start(notes_dir: &Path, debounce_ms: u64, on_change: impl Fn(Vec<String>) + Send + 'static) -> Result<WatcherHandle, NoteError>`; `WatcherHandle::stop(self)`. Callback nhận danh sách id (tên file .md không đuôi, loại trừ `.trash/`).

- [ ] **Step 1: Test failing** (polling, timeout 5s):

```rust
#[test] reports_created_note_id();   // tạo a.md trong tempdir → callback nhận ["a"] trong 5s
#[test] ignores_trash_and_non_md();  // ghi .trash/x.md, b.txt → không callback
```

- [ ] **Step 2: Chạy fail** → compile error.
- [ ] **Step 3: Implement** — `notify_debouncer_full::new_debouncer` watch recursive; trong thread callback: lọc event path đuôi `.md`, cha là notes_dir (không `.trash`), đẩy id vào HashSet → gọi closure với vec (dedup + sort). `WatcherHandle` giữ `ChannelSender` stop hoặc `Drop` dừng watcher (dùng `panic::catch_unwind`-free: giữ sender, drop = watcher kết thúc tự nhiên vì debouncer giữ trong thread; đơn giản: handle giữ `std::sync::mpsc::Sender<()>` + thread flag).
- [ ] **Step 4: Chạy pass** → 2 test PASS (chạy riêng `cargo test -p notes-core watcher -- --test-threads=1` nếu flaky).
- [ ] **Step 5: Commit** — `phase-1: notes-core file watcher với debounce`

---

### Task 5: Tauri app — state, demo notes, commands, event wiring

**Files:**
- Create: `src-tauri/src/state.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/notes.rs`, `src-tauri/src/commands/stats.rs`, `src-tauri/resources/demo/01-welcome.md`, `02-markdown.md`, `03-checklist.md`, `04-ai-assistant.md`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml` (+ `tauri-plugin-dialog = "2"` cho "open data folder" ở settings)

**Interfaces:**
- Consumes: `NotesStore`, `Note`, `NoteMeta`, `NotePatch`, `Stats` (Task 3)
- Produces (frontend Task 6 gọi qua `invoke`):
  - Commands: `list_notes() -> Vec<NoteMeta>`, `read_note(id) -> Note`, `create_note(title, body?, tags?) -> Note`, `update_note(id, patch: NotePatchDto) -> Note`, `delete_note(id)`, `restore_note(id) -> Note`, `search_notes(query, limit?) -> Vec<NoteMeta>`, `list_tags() -> Vec<TagCount{name,count}>`, `get_stats() -> Stats`
  - Setup: nếu store flag `onboarded` chưa có → seed 4 demo notes từ `include_str!`, set flag. Watcher spawn trong `setup` → `app_handle.emit("notes://changed", ids)`; store gọi `reload()` trước khi emit.

- [ ] **Step 1: Demo notes** — 4 file .md có frontmatter đúng schema (title tiếng Việt; 03-checklist có checkboxes; 04-ai-assistant mô tả Phase 2). Frontmatter id để placeholder `PENDING` — seed code sẽ thay id thật khi parse (ghi `id: ""`, store.create ghi đè). Đơn giản hơn: seed gọi `store.create(title, body, tags)` với body = phần thân (không frontmatter) — **chọn cách này**, file demo chỉ chứa markdown body.
- [ ] **Step 2: Implement state + commands** — `state.rs`: `pub struct AppState { pub store: Mutex<NotesStore> }`. Commands mỏng: lock store, gọi phương thức, map `NoteError` → `Result<T, String>` (format `code: message`) để invoke bắt lỗi dễ. Setup hook: seed + watcher (`let handle = app.handle().clone(); std::thread::spawn(move || watcher loop)`).
- [ ] **Step 3: Kiểm chứng** — `cargo check` pass; `npm run tauri dev` mở app (UI vẫn placeholder), kiểm `%APPDATA%/com.dungnt.dntnote/notes/` có 4 file .md + frontmatter đúng sau lần chạy đầu. (Commands chưa có UI gọi — smoke bằng devtools console: `await __TAURI__.core.invoke('list_notes')` trả mảng 4 phần tử.)
- [ ] **Step 4: Commit** — `phase-1: tauri commands + demo seed + watcher event`

---

### Task 6: Frontend foundation — types, api layer, stores, theme tokens

**Files:**
- Create: `src/lib/api/notes.ts`, `src/lib/store/notesStore.ts`, `src/lib/store/uiStore.ts`, `src/lib/utils.ts` (cn), `src/lib/debounce.ts`, `src/theme/tokens.css`, `src/components/theme/ThemeProvider.tsx`
- Modify: `src/index.css`, `src/App.tsx`

**Interfaces:**
- Consumes: Task 5 commands (tên invoke + shape camelCase như trên)
- Produces (Task 7–10 dùng):
  - `api.notes.*`: `list(): Promise<NoteMeta[]>`, `read(id)`, `create(title, body?, tags?)`, `update(id, patch)`, `del(id)`, `restore(id)`, `search(q, limit?)`, `tags()`, `stats()`
  - `useNotes` store: `{ notes: NoteMeta[], selectedId: string | null, tags, loading, byId cache body, load(), select(id), create(), del(id) (giữ lastDeleted cho undo), undoDelete(), setBody(id, body) → debounce 600ms → update, setTitle/setPinned/setTags, flushSave(id) }`
  - `useUi`: `{ searchQuery, setSearchQuery, paletteOpen, settingsOpen, chatOpen (Phase 2) }`
  - ThemeProvider: class `dark` trên `<html>`, localStorage `theme: light|dark|system`, matchMedia listener.
  - `tokens.css`: variables `--bg, --bg-panel, --bg-elevated, --text, --text-secondary, --border, --accent, --danger, --radius-*` cho light + `.dark`; typography classes `.t-xs(11px) … .t-2xl(28px)`.

- [ ] **Step 1: Test failing** — `src/lib/debounce.test.ts` (timer fake: gọi 3 lần trong 100ms → 1 lần sau 600ms), `src/lib/store/notesStore.test.ts` (mock `lib/api/notes` qua `vi.mock`: setBody → không gọi api ngay, advance 600ms → gọi `update` đúng 1 lần với body mới; `del` → `lastDeleted` giữ note; `undoDelete` → gọi `restore` + note quay lại list).
- [ ] **Step 2: Chạy fail** — `npm test` → fail.
- [ ] **Step 3: Implement** — đúng interfaces trên. App.tsx render `<ThemeProvider><div>DNT Note</div></ThemeProvider>` (Task 8 thay UI thật).
- [ ] **Step 4: Chạy pass** — `npm test` PASS.
- [ ] **Step 5: Commit** — `phase-1: frontend api layer + stores + theme tokens`

---

### Task 7: Editor CM6 live-preview kiểu Obsidian

**Files:**
- Create: `src/lib/editor/livePreview.ts` (decorations), `src/lib/editor/editorSetup.ts` (extension set), `src/lib/editor/checkboxWidget.ts`
- Test: `src/lib/editor/livePreview.test.ts`

**Interfaces:**
- Consumes: `@codemirror/lang-markdown` (`markdown({ codeLanguages: languages?, extensions: [gfm()] })` từ `@lezer/markdown` GFM), `@codemirror/view`
- Produces (Task 8 dùng):
  - `editorSetup(options: { onChange: (body: string) => void, onFocusLine?: (line: number) => void }) -> Extension[]` — gồm: markdown lang + gfm, `livePreview()`, history, keymap (Mod-s → force save qua onChange ngay, mặc định indentWithTab off), lineWrapping, theme tối giản dùng CSS vars.
  - `livePreview(): Extension` — ViewPlugin sinh `Decoration`:
    - Frontmatter: nếu doc bắt đầu `---` → RangeSet decoration class `cm-frontmatter` cho khối đầu, bỏ qua live-preview bên trong.
    - Heading: `ATXHeading1..6` → line decoration class `cm-h1…cm-h6`; nếu dòng không active → mark decoration ẩn ký tự `#{1,6} ` (decoration `replace` với widget rỗng? — KHÔNG: dùng mark class `cm-hidden-mark` với CSS `font-size:0` vẫn giữ cursor math đúng; chọn cách: `Decoration.replace({})` chỉ khi dòng không active và không có selection trong dòng).
    - `StrongEmphasis`/`Emphasis`/`Strikethrough` (gfm): dòng không active → mark `cm-bold/cm-em/cm-strike` bao văn bản + ẩn cặp `**`/`*`/`~~` (replace).
    - `InlineCode`/`FencedCode`: mark `cm-code` + nền; fenced: block decoration `cm-code-block` nền + giữ syntax.
    - `Link`: mark `cm-link`, URL trong `()` ẩn khi dòng không active.
    - `Task`/`TaskMarker` (gfm task list): thay `[ ]`/`[x]` bằng `CheckboxWidget(checked)` (WidgetType để replace) — click dispatch transaction thay đổi text `- [ ]`↔`- [x]`.
    - "Active line" = dòng chứa đầu hoặc cuối selection chính; decorations "thô" chỉ áp dòng không active; plugin re-compute khi `update` (docChanged, selectionSet, viewport changed).
  - Pure helpers test được: `lineIsActive(state, lineNo): boolean`, `collectLineDecorations(ctx: { node: SyntaxNodeRef, lineText: string, isActive: boolean }): DecorationSpec[]` — `DecorationSpec` = `{ from, to, kind: "mark"|"replace"|"line", class?: string, widget?: "checkbox", checked?: boolean }` (test không cần EditorView thật).

- [ ] **Step 1: Test failing** — `livePreview.test.ts` dùng `EditorState.create({ doc, extensions: [markdown({ extensions: [gfm()] }), livePreviewTestable] })` + assert qua `collectLineDecorations`:

```ts
describe("live preview decorations", () => {
  it("hides heading marks on inactive lines", ...)       // doc "# Tiêu đề", selection dòng khác → spec replace từ 0 tới 2 + line class cm-h1
  it("keeps raw marks on active line", ...)              // selection trong dòng → không có replace
  it("marks bold text and hides asterisks when inactive", ...) // "**chữ**" → mark cm-bold [2,6), replace [0,2) và [8,10)
  it("frontmatter lines get cm-frontmatter class", ...)
  it("task marker becomes checkbox spec", ...)           // "- [x] done" → replace widget checkbox checked=true
})
describe("checkbox toggle", () => {
  it("toggles [ ] <-> [x] via transaction helper", ...)  // toggleTaskAt(state, pos) → doc text đổi
})
```

- [ ] **Step 2: Chạy fail** — `npm test` → fail.
- [ ] **Step 3: Implement** — đúng interfaces trên. Lưu ý hiệu năng: chỉ duyệt `viewport` lines, recompute trong `update(viewportChanged || docChanged || selectionSet)`. Widget class `cm-checkbox` dùng `<input type=checkbox>` DOM, event `mousedown` → `preventDefault` + dispatch change (để không mất focus editor).
- [ ] **Step 4: Chạy pass** — `npm test` PASS.
- [ ] **Step 5: Commit** — `phase-1: CM6 live preview decorations + interactive checkboxes`

---

### Task 8: UI 3 cột — TitleBar, Sidebar/NoteList, Editor, EmptyState

**Files:**
- Create: `src/components/layout/TitleBar.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/notes/NoteList.tsx`, `src/components/notes/NoteItem.tsx`, `src/components/notes/NoteEditor.tsx`, `src/components/common/EmptyState.tsx`
- Modify: `src/App.tsx` (layout grid 3 cột: sidebar 280px | editor 1fr | chat panel Phase 2 ẩn), `src/index.css` (import tokens)
- Test: `src/components/notes/NoteList.test.tsx`, `src/lib/filterNotes.ts` + test

**Interfaces:**
- Consumes: `useNotes`, `useUi` (Task 6), `editorSetup` (Task 7), `@tauri-apps/api/window` (`getCurrentWindow().minimize/toggleMaximize/close`, drag qua `data-tauri-drag-region`)
- Produces: layout chính chạy được end-to-end: chọn note → load body → sửa → autosave (chỉ báo "Saving…/Saved" ở EditorHeader), Ctrl+N tạo note mới + select, search box lọc client-side.

- [ ] **Step 1: Test failing filter + list** — `filterNotes(notes, query)`: trả notes khớp title hoặc snippet (case-insensitive, trim; rỗng → all, giữ thứ tự store). NoteList.test (render với 3 notes mock + query "md" → đúng 1 item; click item → select được gọi).
- [ ] **Step 2: Chạy fail** → `npm test` fail.
- [ ] **Step 3: Implement**
  - `TitleBar`: h-10, drag region, icon + "DNT Note", nút search (mở palette — Task 10, Phase 1 để nút disabled? Không: render nút gọi `useUi.openPalette()` — palette thật đến Task 10, Phase này để `paletteOpen` toggling một dialog rỗng: tránh placeholder → làm Task 10 trước trong cùng task? **Gộp palette minimal vào task này**: dialog liệt kê actions New note/Toggle theme + notes fuzzy — đầy đủ, không rỗng).
  - `Sidebar`: nút "+ New note" (Ctrl+N), search input (Ctrl+F focus), tag chips filter (click → set ui.tagFilter), `NoteList` nhóm PINNED/ALL; `NoteItem`: title (t-2xl? không — t-sm 14px medium), snippet t-xs text-secondary, ngày (relative "hôm qua"), tag chips nhỏ, hover: nút pin + xóa (xóa qua Task 9 undo flow — ở đây gọi `useNotes.del`).
  - `NoteEditor`: header (title input t-2xl 28px, tags input tối giản "enter để thêm", pin toggle, chỉ báo save state), body: `useCodeMirror` ref mount `editorSetup({ onChange: setBody })` + `Dispatch` khi đổi note (replace toàn bộ doc, preserve scroll off). EmptyState khi không chọn note: logo + "Tạo ghi chú đầu tiên (Ctrl+N)".
- [ ] **Step 4: Chạy pass + smoke** — `npm test` PASS; `npm run tauri dev`: tạo/sửa/đổi note thấy autosave ghi file (kiểm mtime), đổi note khác và quay lại thấy nội dung.
- [ ] **Step 5: Commit** — `phase-1: UI 3 cột + editor mount + palette minimal`

---

### Task 9: Tags/pin hoàn chỉnh + Trash + Undo

**Files:**
- Create: `src/components/common/UndoToast.tsx`, `src/components/notes/TagInput.tsx`
- Modify: `src/lib/store/notesStore.ts` (undo), `src/components/notes/*` (wire), `src/App.tsx` (global Ctrl+Z, toast host)

**Interfaces:**
- Consumes: `useNotes.del/undoDelete/restore`, `api.notes.tags`, `useUi` toast state (`useUi.toasts` hoặc `useToast` mini-store trong uiStore)
- Produces: xóa note → toast góc dưới "Đã xóa <title> — Ctrl+Z để hoàn tác" tự tắt 10s; Ctrl+Z trong 10s → `restore`; tag CRUD hoàn chỉnh (thêm Enter, xóa nút ×, click tag ở list = filter); pin toggle sync cả list lẫn editor header.

- [ ] **Step 1: Test failing** — `notesStore.test.ts` thêm: `del` + `undoDelete` sau khi `del` lần nữa → restore gọi 2 lần đúng id; `toast tự hết hạn` (fake timers 10s → toast removed).
- [ ] **Step 2: Chạy fail.**
- [ ] **Step 3: Implement** — UndoToast render từ uiStore.toasts (mỗi toast: id, message, actionLabel, onAction, expiresAt); App đăng keydown Ctrl+Z → gọi onAction toast undo mới nhất nếu còn.
- [ ] **Step 4: Chạy pass + smoke** — PASS; tauri dev: xóa → undo được, note quay lại đúng vị trí.
- [ ] **Step 5: Commit** — `phase-1: trash + undo toast + tag/pin wiring`

---

### Task 10: Command palette hoàn chỉnh + shortcuts + Settings + theme

**Files:**
- Create: `src/components/layout/CommandPalette.tsx`, `src/lib/fuzzy.ts`, `src/components/settings/SettingsDialog.tsx`, `src/components/settings/AppearanceSection.tsx`, `src/components/settings/DataSection.tsx`
- Modify: `src/App.tsx` (hotkeys), `src/lib/store/uiStore.ts` (settingsOpen, tagFilter), `src/components/layout/TitleBar.tsx` (nút theme + settings thật)
- Test: `src/lib/fuzzy.test.ts`

**Interfaces:**
- Consumes: `api.notes.list/tags/stats`, `useNotes.create/select`, ThemeProvider (setTheme), `@tauri-apps/plugin-opener` (`openPath(appDataDir()/notes)`) — dùng `@tauri-apps/api/path` lấy dir.
- Produces: `fuzzyMatch(query, text): number | null` (subsequence, điểm: consecutive bonus, start-of-word bonus; null = không khớp) — palette sort theo điểm. Palette items = actions (New note, Toggle theme, Light/Dark/System, Settings, Empty trash) + notes (chọn → select + đóng). Settings dialog 3 tab: **Appearance** (theme radio 3 lựa chọn), **Data** (nút "Mở thư mục dữ liệu" → opener.openPath, "Xóa thùng rác" → gọi command `empty_trash`? — KHÔNG có trong Task 5; thêm command `empty_trash` vào đây trong Task này, có test rust `empty_trash_deletes_trash_files`), **About** (phiên bản 0.1.0, ghi credit NoteStudio). Hotkeys: Ctrl+P và Ctrl+K mở palette, Ctrl+N new, Ctrl+S force save, Esc đóng.

- [ ] **Step 1: Test failing** — `fuzzy.test.ts`: `fuzzyMatch("nt", "DNT Note") != null` (khớp D-N-T? "nt" khớp "N"ote "T"? assertion cụ thể: `fuzzyMatch("dnt", "DNT Note")` !== null; `fuzzyMatch("xyz", "DNT Note")` === null; điểm "dn" < điểm "dnt" trên cùng text).
- [ ] **Step 2: Chạy fail.**
- [ ] **Step 3: Implement** — fuzzy + palette + settings + empty_trash (Rust: lặp `.trash/*.md` xóa; test trong `src-tauri/src/commands/notes.rs` `#[cfg(test)]` với tauri::test? — command dùng store từ state: tách logic `empty_trash_dir(dir: &Path)` vào notes-core (`store.empty_trash()` + test tempdir) rồi command gọi. **Quyết định: `NotesStore::empty_trash() -> usize` ở notes-core kèm test.**)
- [ ] **Step 4: Chạy pass + smoke** — PASS cả `npm test` lẫn `cargo test`; tauri dev: Ctrl+K mở, gõ "md" thấy note, Enter mở; đổi theme dark sáng đúng tokens; mở thư mục dữ liệu mở Explorer.
- [ ] **Step 5: Commit** — `phase-1: command palette + settings + empty trash`

---

### Task 11: First-run polish + smoke checklist + build verify

**Files:**
- Modify: `src-tauri/src/lib.rs` (nếu cần), `README.md` (mới: mô tả, cách chạy, phím tắt), `docs/superpowers/plans/2026-09-26-phase-1-notes-core.md` (tick hết)

**Interfaces:** Không đổi API — chỉ hoàn thiện.

- [ ] **Step 1: Smoke checklist chạy tay** (ghi kết quả vào README mục "Đã kiểm chứng"):
  1. Chạy lần đầu → 4 demo notes xuất hiện.
  2. Ctrl+N → note mới, gõ `# Tiêu đề` + `- [ ] việc` → live preview đúng, click checkbox đổi file.
  3. Sửa → dừng 600ms → "Saved" + file mtime đổi.
  4. Tạo note ngoài app (Notepad ghi `<uuid>.md` vào notes dir) → ≤1s app hiện note mới (watcher).
  5. Xóa → Ctrl+Z → note trở lại; Empty trash trong Settings xóa .trash.
  6. Ctrl+K palette tìm + mở; theme System theo Windows; contrast chữ phụ đọc được.
  7. Search lọc tức thời; tag filter hoạt động.
- [ ] **Step 2: Build verify** — `npm run build` (tsc + vite) PASS; `cargo test` toàn workspace PASS; `npm run tauri build` tạo installer NSIS (chấp nhận dài; nếu không có env build đủ — chỉ `cargo build --release` pass).
- [ ] **Step 3: Commit** — `phase-1: polish + readme + smoke verified`

---

## Self-review (đã chạy)

1. **Spec coverage Phase 1** (spec §5.1): CRUD ✓(T3,T5), file .md+frontmatter ✓(T2), search ✓(T3,T8), CM6 live preview ✓(T7), autosave 600ms ✓(T6), tags/pin/trash+undo ✓(T3,T6,T9), Light/Dark/System + tokens ✓(T6,T10), palette Ctrl+K ✓(T10), shortcuts Ctrl+N/F/S ✓(T8,T10), demo notes ✓(T5). Trash = `.trash/` ✓. Nghi vấn: live preview bảng/table → spec §5.1 nói "table render inline" — plan chỉ style monospace Phase 1, ghi rõ ở đây: **table full-render đẩy Phase 2 polish** (đã ghi trong Task 7 interface — chấp nhận).
2. **Placeholder scan:** không có TBD/TODO; mọi step có code/command cụ thể (code dài được mô tả bằng interface + chiến lược đủ chi tiết để implementer không đoán).
3. **Type consistency:** `NoteMeta{id,title,tags,pinned,created,updated,snippet,wordCount}` thống nhất T2→T5→T6; `NotePatch` T3 ↔ T5 Dto ↔ T6 patch; event `notes://changed` T4↔T5↔T6; `empty_trash` bổ sung notes-core store T10 — đã ghi rõ thêm vào store interface T3.
