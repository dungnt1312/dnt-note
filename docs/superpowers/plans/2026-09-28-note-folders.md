# Note Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm thư mục ghi chú 1 cấp: tạo/đổi tên/xoá thư mục, chuyển note vào–ra thư mục, lọc sidebar theo thư mục — folder đi theo frontmatter note nên sync mirror hoạt động không đổi.

**Architecture:** Folder là trường `folder: Option<String>` trên `Note`/`NoteMeta` (None = root) + registry `folders.json` ở appData root (giữ folder rỗng sống sót). Danh sách folder hiển thị = union(registry, giá trị folder của notes). Watcher/sync/search không đổi; mọi operation đổi folder bump `updated` để sync newer-wins kéo theo.

**Tech Stack:** Rust (notes-core crate, tauri v2), React + zustand + Tailwind v4, vitest + testing-library, cargo test.

**Spec:** `docs/superpowers/specs/2026-09-28-note-folders-design.md`

## Global Constraints

- Notes vẫn là file phẳng `notes/<uuid>.md` — KHÔNG tạo thư mục con thật trên đĩa.
- Mọi operation đổi folder trên note **bump `updated`** (sync tie = bỏ qua cả hai bên).
- So khớp tên thư mục **case-insensitive bằng `to_lowercase()`** (Unicode).
- Tên folder: trim, 1–80 ký tự, duy nhất case-insensitive.
- Tauri commands trả `Result<_, String>` (prefix `note-error: `).
- i18n: thêm key song song vi + en trong `src/i18n/sidebar.ts` (dùng `defineDict`, key parity bắt buộc).
- Test assert tiếng Việt (`vitest.setup.ts` pin `lang: "vi"`).
- Folder không thêm vào `NotePatch`/`NotePatchDto` — chỉ qua command riêng.

---

### Task 1: Rust — trường `folder` trên Note + frontmatter round-trip

**Files:**
- Modify: `src-tauri/crates/notes-core/src/note.rs`
- Modify: `src-tauri/crates/notes-core/src/note_file.rs`

**Interfaces:**
- Produces: `Note.folder: Option<String>`, `NoteMeta.folder: Option<String>` (serde camelCase → JSON `folder: null` khi None). Frontmatter field `folder` bỏ qua khi None.

- [ ] **Step 1: Sửa test trước (failing test)** — trong `note_file.rs`, module `tests`, thêm:

```rust
    #[test]
    fn folder_round_trips_when_present() {
        let mut note = sample_note();
        note.folder = Some("Công việc".into());
        let parsed = parse(&serialize(&note)).unwrap();
        assert_eq!(parsed.folder, Some("Công việc".into()));
    }

    #[test]
    fn folder_is_none_when_field_missing() {
        let parsed = parse("---\nid: x\n---\nbody").unwrap();
        assert_eq!(parsed.folder, None);
        // Old files without `folder` serialize without the field (no `folder: null`).
        let out = serialize(&parsed);
        assert!(!out.contains("folder"));
    }
```

- [ ] **Step 2: Chạy test xác nhận FAIL**

Run: `cd src-tauri && cargo test -p notes-core note_file`
Expected: FAIL — compile error `no field 'folder' on Note` (cùng lỗi ở `sample_note()`).

- [ ] **Step 3: Implement** — `note.rs`: thêm field vào `Note` và `NoteMeta`, copy trong `From<&Note>`:

```rust
pub struct Note {
    pub id: String,
    pub title: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub folder: Option<String>, // NEW
    pub created: DateTime<Utc>,
    pub updated: DateTime<Utc>,
    pub body: String,
}
// NoteMeta: thêm `pub folder: Option<String>,` ngay sau `pinned`
// From<&Note> for NoteMeta: `folder: note.folder.clone(),`
```

`note_file.rs`: Frontmatter thêm field (skip khi None), parse + serialize gán qua:

```rust
struct Frontmatter {
    id: String,
    title: String,
    tags: Vec<String>,
    pinned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    folder: Option<String>, // NEW
    created: Option<DateTime<Utc>>,
    updated: Option<DateTime<Utc>>,
}
// parse(): `folder: fm.folder,` trong Ok(Note { ... })
// serialize(): `folder: note.folder.clone(),` trong fm struct literal
```

- [ ] **Step 4: Chạy test PASS + toàn bộ crate**

Run: `cd src-tauri && cargo test -p notes-core`
Expected: PASS (store/sync test khác có thể báo compile error tại `Note {..}` literal — Task 2 sửa `store.rs`; nếu chỉ lỗi field-missing tại store.rs thì tạm chấp nhận, commit Task 1 sau khi note_file + note_file tests pass). Nếu `store.rs`/`sync.rs` fail compile: thêm `folder: None,` tạm vào các struct literal `Note {` / `NoteMeta {` đó (store.rs `reload()` fallback + `create()`), phần logic thật ở Task 2.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/crates/notes-core/src/note.rs src-tauri/crates/notes-core/src/note_file.rs src-tauri/crates/notes-core/src/store.rs src-tauri/crates/notes-core/src/sync.rs
git commit -m "feat(notes-core): folder field on notes + frontmatter round-trip"
```

---

### Task 2: Rust — FolderRegistry + folder operations trong NotesStore

**Files:**
- Create: `src-tauri/crates/notes-core/src/folders.rs`
- Modify: `src-tauri/crates/notes-core/src/store.rs` (struct, new, create, các method mới; `write_atomic` đổi temp extension)
- Modify: `src-tauri/crates/notes-core/src/lib.rs` (thêm `pub mod folders;` — kiểm tra file lib.rs của crate xem tên module file hiện có)

**Interfaces:**
- Consumes: `Note.folder` (Task 1).
- Produces (NotesStore methods, dùng ở Task 3):
  - `new(notes_dir: PathBuf, folders_path: PathBuf) -> std::io::Result<Self>`
  - `list_folders(&self) -> Vec<String>` (union, sort theo lowercase)
  - `create_folder(&mut self, name: &str) -> Result<Vec<String>>`
  - `rename_folder(&mut self, old: &str, new: &str) -> Result<usize>`
  - `remove_folder(&mut self, name: &str) -> Result<usize>`
  - `set_note_folder(&mut self, id: &str, folder: Option<&str>) -> Result<Note>`
  - `create(&mut self, title: &str, body: &str, tags: Vec<String>, folder: Option<String>) -> Result<Note>` (signature đổi — thêm tham số cuối)
- `folders::validate_name(raw: &str) -> Result<String>` public.

- [ ] **Step 1: Viết test folders.rs (failing)** — tạo `src-tauri/crates/notes-core/src/folders.rs` với implementation + tests dưới đây, thêm `pub mod folders;` vào `src-tauri/crates/notes-core/src/lib.rs` (file module listing của crate — đọc trước khi sửa):

```rust
use crate::error::{NoteError, Result};
use crate::store::write_atomic;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const MAX_NAME_LEN: usize = 80;

/// Validate + normalize a folder name: trim, non-empty, <= 80 chars.
pub fn validate_name(raw: &str) -> Result<String> {
    let name = raw.trim().to_string();
    if name.is_empty() {
        return Err(NoteError::Unknown("folder name is empty".into()));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(NoteError::Unknown(format!(
            "folder name exceeds {MAX_NAME_LEN} characters"
        )));
    }
    Ok(name)
}

pub fn eq_ci(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

#[derive(Serialize, Deserialize, Default)]
struct FolderFile {
    names: Vec<String>,
}

/// On-disk registry of folder names (`folders.json`). Notes also carry the
/// folder — the registry only keeps empty folders alive; the displayed list
/// is the union of registry names and folder values found on notes.
pub struct FolderRegistry {
    path: PathBuf,
    names: Vec<String>,
}

impl FolderRegistry {
    pub fn load(path: PathBuf) -> Self {
        let names = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<FolderFile>(&s).ok())
            .map(|f| f.names)
            .unwrap_or_default();
        FolderRegistry { path, names }
    }

    pub fn names(&self) -> &[String] {
        &self.names
    }

    pub fn add(&mut self, name: &str) -> Result<()> {
        self.names.push(name.to_string());
        self.save()
    }

    /// Replace `old` (case-insensitive) with `new`; adds `new` if `old` absent.
    pub fn replace(&mut self, old: &str, new: &str) -> Result<()> {
        match self.names.iter().position(|n| eq_ci(n, old)) {
            Some(pos) => self.names[pos] = new.to_string(),
            None => self.names.push(new.to_string()),
        }
        self.save()
    }

    pub fn remove(&mut self, name: &str) -> Result<()> {
        self.names.retain(|n| !eq_ci(n, name));
        self.save()
    }

    fn save(&self) -> Result<()> {
        let json = serde_json::to_string_pretty(&FolderFile {
            names: self.names.clone(),
        })
        .map_err(|e| NoteError::Unknown(e.to_string()))?;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        write_atomic(&self.path, json.as_bytes())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn registry(tmp: &TempDir) -> FolderRegistry {
        FolderRegistry::load(tmp.path().join("folders.json"))
    }

    #[test]
    fn validate_trims_and_rejects_empty_or_too_long() {
        assert_eq!(validate_name("  Công việc  ").unwrap(), "Công việc");
        assert!(validate_name("   ").is_err());
        let long = "x".repeat(MAX_NAME_LEN + 1);
        assert!(validate_name(&long).is_err());
        assert!(validate_name(&"x".repeat(MAX_NAME_LEN)).is_ok());
    }

    #[test]
    fn eq_ci_ignores_unicode_case() {
        assert!(eq_ci("Work", "work"));
        assert!(eq_ci("Đồ án", "đồ án"));
        assert!(!eq_ci("Work", " Works"));
    }

    #[test]
    fn add_replace_remove_persist_across_reopen() {
        let tmp = TempDir::new().unwrap();
        let mut reg = registry(&tmp);
        reg.add("Work").unwrap();
        reg.add("Life").unwrap();
        reg.replace("work", "Việc làm").unwrap();
        reg.remove("LIFE").unwrap();
        // Reopen from disk.
        let reg2 = registry(&tmp);
        assert_eq!(reg2.names(), &["Việc làm".to_string()]);
    }

    #[test]
    fn load_missing_file_yields_empty() {
        let tmp = TempDir::new().unwrap();
        assert!(registry(&tmp).names().is_empty());
    }
}
```

Run: `cd src-tauri && cargo test -p notes-core folders`
Expected: PASS ngay (implementation + test viết cùng lúc — module mới, không breaking).

- [ ] **Step 2: Sửa store.rs — test trước.** Trong `mod tests` của `store.rs`, sửa `setup()` thành 2 tham số và thêm tests:

```rust
    fn setup() -> (TempDir, NotesStore) {
        let tmp = TempDir::new().unwrap();
        let store = NotesStore::new(
            tmp.path().join("notes"),
            tmp.path().join("folders.json"),
        )
        .unwrap();
        (tmp, store)
    }
```

```rust
    #[test]
    fn folder_crud_and_union_listing() {
        let (_tmp, mut store) = setup();
        store.create_folder("Work").unwrap();
        // Union: registry + folder on a note that registry doesn't know.
        let n = store
            .create("Cloud note", "b", vec![], Some("Từ cloud".into()))
            .unwrap();
        assert_eq!(store.list_folders(), vec!["Từ cloud".to_string(), "Work".to_string()]);
        // Duplicate (case-insensitive) is rejected.
        assert!(store.create_folder("work").is_err());
        // Empty/blank names rejected.
        assert!(store.create_folder("   ").is_err());
        let _ = n;
    }

    #[test]
    fn set_note_folder_moves_and_bumps_updated() {
        let (_tmp, mut store) = setup();
        store.create_folder("Work").unwrap();
        let note = store.create("a", "b", vec![], None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let moved = store.set_note_folder(&note.id, Some("Work")).unwrap();
        assert_eq!(moved.folder.as_deref(), Some("Work"));
        assert!(moved.updated > note.updated);
        // Unknown folder → error.
        assert!(store.set_note_folder(&note.id, Some("Nope")).is_err());
        // Clear → None.
        let cleared = store.set_note_folder(&note.id, None).unwrap();
        assert_eq!(cleared.folder, None);
    }

    #[test]
    fn rename_folder_updates_registry_and_notes() {
        let (_tmp, mut store) = setup();
        store.create_folder("Work").unwrap();
        let a = store.create("a", "b", vec![], Some("work".into())).unwrap();
        let b = store.create("b", "c", vec![], None).unwrap();
        let moved = store.rename_folder("Work", "Việc").unwrap();
        assert_eq!(moved, 1);
        assert_eq!(store.read(&a.id).unwrap().folder.as_deref(), Some("Việc"));
        assert_eq!(store.read(&b.id).unwrap().folder, None);
        assert!(store.list_folders().contains(&"Việc".to_string()));
        assert!(!store.list_folders().iter().any(|f| f.eq_ignore_ascii_case("work")));
        // Renaming bumps updated so sync newer-wins picks the change up.
        assert!(store.read(&a.id).unwrap().updated >= a.updated);
        // Unknown source folder → error.
        assert!(store.rename_folder("Nope", "X").is_err());
        // Renaming onto an existing folder → error.
        store.create_folder("Khác").unwrap();
        assert!(store.rename_folder("Việc", "khác").is_err());
    }

    #[test]
    fn remove_folder_unfiles_notes_and_registry() {
        let (_tmp, mut store) = setup();
        store.create_folder("Temp").unwrap();
        let a = store.create("a", "b", vec![], Some("Temp".into())).unwrap();
        let moved = store.remove_folder("temp").unwrap();
        assert_eq!(moved, 1);
        assert_eq!(store.read(&a.id).unwrap().folder, None);
        assert!(!store.list_folders().contains(&"Temp".to_string()));
        assert_eq!(store.remove_folder("Temp").unwrap(), 0);
    }

    #[test]
    fn folders_persist_across_store_reopen() {
        let tmp = TempDir::new().unwrap();
        let mut store = NotesStore::new(tmp.path().join("notes"), tmp.path().join("folders.json")).unwrap();
        store.create_folder("Lâu dài").unwrap();
        drop(store);
        let store2 = NotesStore::new(tmp.path().join("notes"), tmp.path().join("folders.json")).unwrap();
        assert!(store2.list_folders().contains(&"Lâu dài".to_string()));
    }

    #[test]
    fn reload_fallback_meta_has_no_folder() {
        let (tmp, mut store) = setup();
        fs::write(tmp.path().join("notes/broken.md"), "no frontmatter").unwrap();
        store.reload();
        assert_eq!(store.list()[0].folder, None);
    }
```

- [ ] **Step 3: Chạy test xác nhận FAIL/compile error**

Run: `cd src-tauri && cargo test -p notes-core store::`
Expected: FAIL — `NotesStore::new` nhận 1 tham số, methods chưa tồn tại.

- [ ] **Step 4: Implement store.rs.** Các thay đổi:

1. Top of file: `use crate::folders::{eq_ci, FolderRegistry};`
2. Struct: thêm `folders: FolderRegistry,`
3. `new`:

```rust
    pub fn new(notes_dir: PathBuf, folders_path: PathBuf) -> std::io::Result<Self> {
        let trash_dir = notes_dir.join(".trash");
        fs::create_dir_all(&trash_dir)?;
        let mut store = NotesStore {
            dir: notes_dir,
            trash_dir,
            folders: FolderRegistry::load(folders_path),
            index: HashMap::new(),
        };
        store.reload();
        Ok(store)
    }
```

4. `create` thêm tham số `folder: Option<String>` và set vào `Note { ..., folder, ... }`.
5. Fallback `NoteMeta` trong `reload()`: thêm `folder: None,`.
6. Public methods:

```rust
    /// Union of registered folder names and folder values found on notes,
    /// sorted case-insensitively.
    pub fn list_folders(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for name in self.folders.names() {
            if !out.iter().any(|n| eq_ci(n, name)) {
                out.push(name.clone());
            }
        }
        for meta in self.index.values() {
            if let Some(f) = &meta.folder {
                if !out.iter().any(|n| eq_ci(n, f)) {
                    out.push(f.clone());
                }
            }
        }
        out.sort_by_key(|a| a.to_lowercase());
        out
    }

    pub fn create_folder(&mut self, raw_name: &str) -> Result<Vec<String>> {
        let name = crate::folders::validate_name(raw_name)?;
        if self.list_folders().iter().any(|n| eq_ci(n, &name)) {
            return Err(NoteError::Unknown(format!("folder already exists: {name}")));
        }
        self.folders.add(&name)?;
        Ok(self.list_folders())
    }

    pub fn rename_folder(&mut self, old: &str, new_raw: &str) -> Result<usize> {
        let new = crate::folders::validate_name(new_raw)?;
        let known = self.folders.names().iter().any(|n| eq_ci(n, old))
            || self
                .index
                .values()
                .any(|m| m.folder.as_deref().is_some_and(|f| eq_ci(f, old)));
        if !known {
            return Err(NoteError::NotFound(format!("folder {old}")));
        }
        if !eq_ci(old, &new) && self.list_folders().iter().any(|n| eq_ci(n, &new)) {
            return Err(NoteError::Unknown(format!("folder already exists: {new}")));
        }
        let moved = self.retarget_notes_matching(old, Some(&new))?;
        self.folders.replace(old, &new)?;
        Ok(moved)
    }

    pub fn remove_folder(&mut self, name: &str) -> Result<usize> {
        let moved = self.retarget_notes_matching(name, None)?;
        self.folders.remove(name)?;
        Ok(moved)
    }

    pub fn set_note_folder(&mut self, id: &str, folder: Option<&str>) -> Result<Note> {
        if !self.index.contains_key(id) {
            return Err(NoteError::NotFound(id.to_string()));
        }
        let canonical = match folder {
            Some(f) => {
                let name = crate::folders::validate_name(f)?;
                self.list_folders()
                    .into_iter()
                    .find(|n| eq_ci(n, &name))
                    .ok_or_else(|| NoteError::NotFound(format!("folder {name}")))?
            }
            None => String::new(),
        };
        let mut note = self.read(id)?;
        note.folder = if folder.is_some() { Some(canonical) } else { None };
        note.updated = Utc::now();
        self.write_note(&note)?;
        self.index.insert(note.id.clone(), NoteMeta::from(&note));
        Ok(note)
    }

    /// Rewrite every note whose folder matches `name` (case-insensitive) so it
    /// carries `new_folder`; bumps `updated` so the sync mirror propagates it.
    fn retarget_notes_matching(&mut self, name: &str, new_folder: Option<&str>) -> Result<usize> {
        let ids: Vec<String> = self
            .index
            .values()
            .filter(|m| m.folder.as_deref().is_some_and(|f| eq_ci(f, name)))
            .map(|m| m.id.clone())
            .collect();
        let mut moved = 0;
        for id in ids {
            let mut note = self.read(&id)?;
            note.folder = new_folder.map(|f| f.to_string());
            note.updated = Utc::now();
            self.write_note(&note)?;
            self.index.insert(note.id.clone(), NoteMeta::from(&note));
            moved += 1;
        }
        Ok(moved)
    }
```

7. `write_atomic` — temp extension hiện hardcode `"md.tmp"`; đổi thành generic để dùng cho JSON:

```rust
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}
```

- [ ] **Step 5: Sửa các call site `NotesStore::new` còn lại** — `sync.rs` test helper `setup_pair()` thêm tham số `tmp.path().join("folders.json")`. Grep toàn crate: `grep -rn "NotesStore::new" src-tauri/` — mỗi chỗ thêm path `folders.json`.

- [ ] **Step 6: Chạy toàn bộ notes-core**

Run: `cd src-tauri && cargo test -p notes-core`
Expected: PASS (toàn bộ, gồm test cũ — `create` cũ trong test `create_and_list_roundtrip` cần thêm `None` cho tham số folder: sửa các call `store.create(...)` trong tests thêm đối số cuối `None`).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/crates/notes-core/
git commit -m "feat(notes-core): folder registry + folder operations on NotesStore"
```

---

### Task 3: Tauri commands + wiring

**Files:**
- Modify: `src-tauri/src/commands/notes.rs`
- Modify: `src-tauri/src/lib.rs` (init store path + register commands)

**Interfaces:**
- Consumes: Task 2 methods.
- Produces (JS-side, dùng ở Task 4): commands `list_folders` → `string[]`; `create_folder(name)` → `string[]`; `rename_folder(old, new)` → `{ folders: string[]; moved: number }`; `delete_folder(name)` → `{ folders: string[]; moved: number }`; `move_note_to_folder(id, folder: string | null)` → `Note`. `create_note` nhận thêm `folder?: string`.

- [ ] **Step 1: commands/notes.rs** — thêm (cạnh các note commands):

```rust
#[tauri::command]
pub fn create_note(
    state: State<AppState>,
    title: String,
    body: Option<String>,
    tags: Option<Vec<String>>,
    folder: Option<String>,
) -> CmdResult<Note> {
    let mut store = state.store.lock().map_err(err_of)?;
    store
        .create(
            &title,
            body.as_deref().unwrap_or(""),
            tags.unwrap_or_default(),
            folder,
        )
        .map_err(err_of)
}

#[tauri::command]
pub fn list_folders(state: State<AppState>) -> CmdResult<Vec<String>> {
    let store = state.store.lock().map_err(err_of)?;
    Ok(store.list_folders())
}

#[tauri::command]
pub fn create_folder(state: State<AppState>, name: String) -> CmdResult<Vec<String>> {
    let mut store = state.store.lock().map_err(err_of)?;
    store.create_folder(&name).map_err(err_of)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderMutation {
    pub folders: Vec<String>,
    pub moved: usize,
}

#[tauri::command]
pub fn rename_folder(state: State<AppState>, old: String, new: String) -> CmdResult<FolderMutation> {
    let mut store = state.store.lock().map_err(err_of)?;
    let moved = store.rename_folder(&old, &new).map_err(err_of)?;
    Ok(FolderMutation {
        folders: store.list_folders(),
        moved,
    })
}

#[tauri::command]
pub fn delete_folder(state: State<AppState>, name: String) -> CmdResult<FolderMutation> {
    let mut store = state.store.lock().map_err(err_of)?;
    let moved = store.remove_folder(&name).map_err(err_of)?;
    Ok(FolderMutation {
        folders: store.list_folders(),
        moved,
    })
}

#[tauri::command]
pub fn move_note_to_folder(
    state: State<AppState>,
    id: String,
    folder: Option<String>,
) -> CmdResult<Note> {
    let mut store = state.store.lock().map_err(err_of)?;
    store.set_note_folder(&id, folder.as_deref()).map_err(err_of)
}
```

(Chỉ đổi `create_note` hiện có bằng version trên — giữ nguyên phần còn lại của file.)

- [ ] **Step 2: lib.rs** — hai chỗ:

```rust
// Trong setup(), thay dòng tạo store:
let folders_path = app_data_dir(&handle).join("folders.json");
let mut notes_store = NotesStore::new(notes_dir.clone(), folders_path)
    .map_err(|e| format!("init store: {e}"))?;

// Trong generate_handler![], thêm sau commands::notes::empty_trash:
commands::notes::list_folders,
commands::notes::create_folder,
commands::notes::rename_folder,
commands::notes::delete_folder,
commands::notes::move_note_to_folder,
```

- [ ] **Step 3: Build + test toàn workspace**

Run: `cd src-tauri && cargo test`
Expected: PASS (gồm seed_demo_notes — call site `store.create` thêm `None` cho tham số folder).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/
git commit -m "feat(tauri): folder commands (list/create/rename/delete/move)"
```

---

### Task 4: TS api + stores (notesStore, uiStore)

**Files:**
- Modify: `src/lib/api/notes.ts`
- Modify: `src/lib/store/notesStore.ts`
- Modify: `src/lib/store/uiStore.ts`
- Modify: `src/lib/store/notesStore.test.ts`

**Interfaces:**
- Consumes: Task 3 commands.
- Produces:
  - `NoteMeta.folder: string | null`
  - `api.folders.list/create/rename/del`, `api.notes.moveToFolder(id, folder)`
  - `useNotesStore`: state `folders: string[]`; actions `loadFolders(): Promise<void>`, `createFolder(name): Promise<string | null>` (trả error message | null), `renameFolder(old, new): Promise<number | string>` (số note moved | error), `deleteFolder(name): Promise<number | string>`, `moveNoteToFolder(id, folder): Promise<string | null | "error">` (trả folder cũ để Undo; `"error"` khi rollback)
  - `useUi`: `folderFilter: string | null`, `setFolderFilter(f: string | null)`
  - `load()` giờ cũng load folders.

- [ ] **Step 1: api/notes.ts** — `NoteMeta` thêm `folder: string | null;` (sau `pinned`). Object `api` thêm:

```ts
    moveToFolder: (id: string, folder: string | null) =>
      invoke<Note>("move_note_to_folder", { id, folder }),
```
trong `api.notes`, và object mới ngang cấp:

```ts
  folders: {
    list: () => invoke<string[]>("list_folders"),
    create: (name: string) => invoke<string[]>("create_folder", { name }),
    rename: (oldName: string, newName: string) =>
      invoke<{ folders: string[]; moved: number }>("rename_folder", { old: oldName, new: newName }),
    del: (name: string) =>
      invoke<{ folders: string[]; moved: number }>("delete_folder", { name }),
  },
```

- [ ] **Step 2: uiStore.ts** — state + setter (đặt cạnh `tagFilter`):

```ts
  folderFilter: string | null;          // state
  setFolderFilter: (f: string | null) => void;  // action
// init: folderFilter: null,
// body: setFolderFilter: (f) => set({ folderFilter: f }),
```

- [ ] **Step 3: Test trước trong notesStore.test.ts (failing)** — mock thêm `folders` + `moveToFolder`:

```ts
vi.mock("../api/notes", () => ({
  api: {
    notes: { /* giữ nguyên các fn hiện có, thêm: */
      moveToFolder: vi.fn(async () => ({ id: "x", title: "", tags: [], pinned: false, folder: null, created: "", updated: "", snippet: "", wordCount: 0, body: "" })),
    },
    folders: {
      list: vi.fn(async () => []),
      create: vi.fn(async (name: string) => [name]),
      rename: vi.fn(async (_o: string, n: string) => ({ folders: [n], moved: 1 })),
      del: vi.fn(async () => ({ folders: [], moved: 2 })),
    },
  },
}));
```

(Note fixtures trong mock `list` cần thêm `folder: null`. beforeEach `useNotesStore.setState({...})` thêm `folders: []`.)

Thêm describe:

```ts
describe("notesStore folders", () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: [], folders: [], tags: [], selectedId: null, body: null, saveState: "saved", lastDeleted: null });
    vi.clearAllMocks();
  });

  it("createFolder sets folders and returns null on success", async () => {
    const err = await useNotesStore.getState().createFolder("Work");
    expect(err).toBeNull();
    expect(useNotesStore.getState().folders).toEqual(["Work"]);
  });

  it("createFolder returns the error message on failure", async () => {
    vi.mocked(api.folders.create).mockRejectedValueOnce("note-error: folder already exists: Work");
    const err = await useNotesStore.getState().createFolder("Work");
    expect(err).toBe("note-error: folder already exists: Work");
    expect(useNotesStore.getState().folders).toEqual([]);
  });

  it("deleteFolder returns moved count and updates list", async () => {
    useNotesStore.setState({ folders: ["Work"] });
    const moved = await useNotesStore.getState().deleteFolder("Work");
    expect(moved).toBe(2);
    expect(useNotesStore.getState().folders).toEqual([]);
  });

  it("moveNoteToFolder updates note optimistically and returns previous folder", async () => {
    useNotesStore.setState({
      notes: [{ id: "n1", title: "A", tags: [], pinned: false, folder: "Work", created: "", updated: "", snippet: "", wordCount: 0 }],
    });
    const prev = await useNotesStore.getState().moveNoteToFolder("n1", "Life");
    expect(prev).toBe("Work");
    expect(useNotesStore.getState().notes[0].folder).toBe("Life");
    expect(api.notes.moveToFolder).toHaveBeenCalledWith("n1", "Life");
  });

  it("moveNoteToFolder rolls back on failure", async () => {
    useNotesStore.setState({
      notes: [{ id: "n1", title: "A", tags: [], pinned: false, folder: "Work", created: "", updated: "", snippet: "", wordCount: 0 }],
    });
    vi.mocked(api.notes.moveToFolder).mockRejectedValueOnce("note-error: x");
    const prev = await useNotesStore.getState().moveNoteToFolder("n1", "Life");
    expect(prev).toBe("error");
    expect(useNotesStore.getState().notes[0].folder).toBe("Work");
  });

  it("load() also fetches folders", async () => {
    vi.mocked(api.folders.list).mockResolvedValueOnce(["Work"]);
    await useNotesStore.getState().load();
    expect(useNotesStore.getState().folders).toEqual(["Work"]);
  });
});
```

- [ ] **Step 4: Chạy test FAIL**

Run: `npm test -- notesStore`
Expected: FAIL — `createFolder is not a function` v.v.

- [ ] **Step 5: Implement notesStore.** Interface thêm fields/actions; body:

```ts
  folders: [],

  load: async () => {
    const [notes, tags, folders] = await Promise.all([
      api.notes.list(),
      api.notes.tags(),
      api.folders.list(),
    ]);
    set({ notes, tags, folders });
  },

  loadFolders: async () => {
    try {
      set({ folders: await api.folders.list() });
    } catch (e) {
      console.error("load folders failed", e);
    }
  },

  createFolder: async (name) => {
    try {
      set({ folders: await api.folders.create(name) });
      return null;
    } catch (e) {
      console.error("create folder failed", e);
      return e instanceof Error ? e.message : String(e);
    }
  },

  renameFolder: async (oldName, newName) => {
    try {
      const { folders, moved } = await api.folders.rename(oldName, newName);
      set({ folders });
      return moved;
    } catch (e) {
      console.error("rename folder failed", e);
      return e instanceof Error ? e.message : String(e);
    }
  },

  deleteFolder: async (name) => {
    try {
      const { folders, moved } = await api.folders.del(name);
      set({ folders });
      return moved;
    } catch (e) {
      console.error("delete folder failed", e);
      return e instanceof Error ? e.message : String(e);
    }
  },

  moveNoteToFolder: async (id, folder) => {
    const prev = get().notes.find((n) => n.id === id)?.folder ?? null;
    if (prev === folder) return prev;
    set((s) => ({
      notes: s.notes.map((n) => (n.id === id ? { ...n, folder } : n)),
    }));
    try {
      await api.notes.moveToFolder(id, folder);
      return prev;
    } catch (e) {
      console.error("move to folder failed", e);
      set((s) => ({
        notes: s.notes.map((n) => (n.id === id ? { ...n, folder: prev } : n)),
      }));
      return "error";
    }
  },
```

(Interface `NotesState` thêm: `folders: string[]; loadFolders: () => Promise<void>; createFolder: (name: string) => Promise<string | null>; renameFolder: (oldName: string, newName: string) => Promise<number | string>; deleteFolder: (name: string) => Promise<number | string>; moveNoteToFolder: (id: string, folder: string | null) => Promise<string | null | "error">;` — và `load` giữ nguyên signature.)

- [ ] **Step 6: Chạy test PASS**

Run: `npm test -- notesStore`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/api/notes.ts src/lib/store/notesStore.ts src/lib/store/notesStore.test.ts src/lib/store/uiStore.ts
git commit -m "feat(store): folders state, folder CRUD actions, moveNoteToFolder with undo data"
```

---

### Task 5: FolderSection UI + sidebar filter + i18n

**Files:**
- Create: `src/components/notes/FolderSection.tsx`
- Modify: `src/components/layout/Sidebar.tsx` (NotesPane: render FolderSection + filter theo folder)
- Modify: `src/i18n/sidebar.ts` (vi + en)

**Interfaces:**
- Consumes: Task 4 store actions/uiStore.
- Produces: `<FolderSection />` (không props — tự đọc stores); NotesPane filter: `notes.filter(folder).filter(tag)`.

- [ ] **Step 1: i18n keys** — `src/i18n/sidebar.ts`, thêm vào CẢ `en` và `vi` (vi:

```ts
    "sidebar.folders": "Thư mục",
    "sidebar.newFolder": "Thư mục mới",
    "sidebar.folderName": "Tên thư mục",
    "sidebar.folderExists": "Thư mục \"{name}\" đã tồn tại",
    "sidebar.renameFolder": "Đổi tên thư mục",
    "sidebar.deleteFolder": "Xoá thư mục",
    "sidebar.deleteFolderTitle": "Xoá thư mục \"{name}\"?",
    "sidebar.deleteFolderDesc": "Các ghi chú trong thư mục sẽ trở lại danh sách chung. Ghi chú không bị xoá.",
    "sidebar.folderDeleted": "Đã xoá thư mục \"{name}\". {n} ghi chú đã chuyển ra ngoài.",
    "sidebar.folderRenamed": "Đã đổi tên thư mục. {n} ghi chú được cập nhật.",
    "sidebar.moveToFolder": "Chuyển tới thư mục…",
    "sidebar.moveToFolderTitle": "Chuyển \"{title}\" vào thư mục",
    "sidebar.noFolder": "Không có thư mục",
    "sidebar.folderRowLabel": "Thư mục {name}, {n} ghi chú",
    "sidebar.movedToFolder": "Đã chuyển tới \"{name}\"",
    "sidebar.moveFailed": "Không thể chuyển ghi chú",
```

; en tương ứng:

```ts
    "sidebar.folders": "Folders",
    "sidebar.newFolder": "New folder",
    "sidebar.folderName": "Folder name",
    "sidebar.folderExists": "Folder \"{name}\" already exists",
    "sidebar.renameFolder": "Rename folder",
    "sidebar.deleteFolder": "Delete folder",
    "sidebar.deleteFolderTitle": "Delete folder \"{name}\"?",
    "sidebar.deleteFolderDesc": "Its notes will move back to the general list. Notes are not deleted.",
    "sidebar.folderDeleted": "Deleted folder \"{name}\". {n} notes moved out.",
    "sidebar.folderRenamed": "Folder renamed. {n} notes updated.",
    "sidebar.moveToFolder": "Move to folder…",
    "sidebar.moveToFolderTitle": "Move \"{title}\" to folder",
    "sidebar.noFolder": "No folder",
    "sidebar.folderRowLabel": "Folder {name}, {n} notes",
    "sidebar.movedToFolder": "Moved to \"{name}\"",
    "sidebar.moveFailed": "Could not move the note",
```

). Nếu `sidebar.undo` chưa tồn tại trong dict: thêm `"sidebar.undo": "Undo" / "Hoàn tác"`.

- [ ] **Step 2: FolderSection.tsx** — file mới:

```tsx
import { useEffect, useRef, useState } from "react";
import { Folder, FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";
import { useT } from "../../lib/i18n";
import { IconButton } from "../ui/Button";
import { ConfirmDialog } from "../ui/Dialog";
import { Menu, MenuItem, MenuSeparator } from "../ui/Menu";
import { SidebarRow } from "../layout/SidebarRow";

/** Sidebar folders block: header with "+" inline create, folder rows with count + row menu. */
export function FolderSection() {
  const t = useT();
  const folders = useNotesStore((s) => s.folders);
  const notes = useNotesStore((s) => s.notes);
  const createFolder = useNotesStore((s) => s.createFolder);
  const renameFolder = useNotesStore((s) => s.renameFolder);
  const deleteFolder = useNotesStore((s) => s.deleteFolder);
  const folderFilter = useUi((s) => s.folderFilter);
  const setFolderFilter = useUi((s) => s.setFolderFilter);
  const pushToast = useUi((s) => s.pushToast);

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  // Folder renamed/deleted elsewhere (sync) → drop the stale filter.
  useEffect(() => {
    if (folderFilter && !folders.some((f) => f.toLowerCase() === folderFilter.toLowerCase())) {
      setFolderFilter(null);
    }
  }, [folders, folderFilter, setFolderFilter]);

  if (folders.length === 0 && !creating) return null;

  const countOf = (name: string) =>
    notes.filter((n) => (n.folder ?? "").toLowerCase() === name.toLowerCase()).length;

  const submitCreate = async () => {
    const name = draft.trim();
    setCreating(false);
    setDraft("");
    if (!name) return;
    if (folders.some((f) => f.toLowerCase() === name.toLowerCase())) {
      pushToast({ message: t("sidebar.folderExists", { name }), durationMs: 5000 });
      return;
    }
    const err = await createFolder(name);
    if (err) pushToast({ message: err, durationMs: 5000 });
    else setFolderFilter(name);
  };

  const submitRename = async (oldName: string) => {
    const newName = renameDraft.trim();
    setRenaming(null);
    setRenameDraft("");
    if (!newName || newName.toLowerCase() === oldName.toLowerCase()) return;
    const res = await renameFolder(oldName, newName);
    if (typeof res === "string") {
      pushToast({ message: res, durationMs: 5000 });
    } else {
      pushToast({ message: t("sidebar.folderRenamed", { n: res }), durationMs: 5000 });
    }
  };

  const confirmDelete = async () => {
    const name = deleting;
    setDeleting(null);
    if (!name) return;
    const res = await deleteFolder(name);
    if (typeof res === "string") {
      pushToast({ message: res, durationMs: 5000 });
    } else {
      pushToast({ message: t("sidebar.folderDeleted", { name, n: res }), durationMs: 5000 });
    }
  };

  return (
    <section aria-label={t("sidebar.folders")} className="px-2">
      <div className="flex items-center justify-between pl-0.5 pr-0.5 pt-3.5 pb-1">
        <span className="text-footnote font-semibold text-fg-secondary">{t("sidebar.folders")}</span>
        <IconButton
          label={t("sidebar.newFolder")}
          className="size-6"
          onClick={() => {
            setDraft("");
            cancelledRef.current = false;
            setCreating(true);
          }}
        >
          <FolderPlus size={14} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      </div>
      <ul className="flex flex-col gap-px">
        {creating && (
          <li>
            <input
              autoFocus
              value={draft}
              aria-label={t("sidebar.folderName")}
              placeholder={t("sidebar.folderName")}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (!cancelledRef.current) void submitCreate();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.stopPropagation();
                  cancelledRef.current = true;
                  setCreating(false);
                  setDraft("");
                }
              }}
              className="h-[30px] w-full rounded-sm border border-fg-tertiary bg-control px-2.5 text-callout text-fg outline-none"
            />
          </li>
        )}
        {folders.map((name) => {
          const active = folderFilter?.toLowerCase() === name.toLowerCase();
          if (renaming === name) {
            return (
              <li key={name}>
                <input
                  autoFocus
                  value={renameDraft}
                  aria-label={t("sidebar.renameFolder")}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => void submitRename(name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setRenaming(null);
                      setRenameDraft("");
                    }
                  }}
                  className="h-[30px] w-full rounded-sm border border-fg-tertiary bg-control px-2.5 text-callout text-fg outline-none"
                />
              </li>
            );
          }
          return (
            <li key={name}>
              <SidebarRow
                selected={active}
                label={t("sidebar.folderRowLabel", { name, n: countOf(name) })}
                onSelect={() => setFolderFilter(active ? null : name)}
                actions={
                  <Menu
                    width={190}
                    trigger={(p) => (
                      <button
                        type="button"
                        {...p}
                        aria-label={t("sidebar.optionsFor", { title: name })}
                        title={t("sidebar.options")}
                        className="flex size-7 items-center justify-center rounded-sm text-fg-secondary hover:bg-selected hover:text-fg"
                      >
                        <MoreHorizontal size={15} aria-hidden="true" />
                      </button>
                    )}
                  >
                    <MenuItem
                      icon={<Pencil size={14} />}
                      onSelect={() => {
                        setRenameDraft(name);
                        setRenaming(name);
                      }}
                    >
                      {t("sidebar.renameFolder")}
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem destructive icon={<Trash2 size={14} />} onSelect={() => setDeleting(name)}>
                      {t("sidebar.deleteFolder")}
                    </MenuItem>
                  </Menu>
                }
              >
                <span className="flex items-center gap-2 py-0.5">
                  <Folder size={14} aria-hidden="true" className={active ? "fill-current text-fg" : "text-fg-secondary"} />
                  <span className="min-w-0 flex-1 truncate text-callout text-fg">{name}</span>
                  <span className="text-footnote tabular-nums text-fg-tertiary">{countOf(name)}</span>
                </span>
              </SidebarRow>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        title={t("sidebar.deleteFolderTitle", { name: deleting ?? "" })}
        description={t("sidebar.deleteFolderDesc")}
        confirmLabel={t("sidebar.delete")}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
```

Lưu ý: `IconButton` phải merge `className` (cn) — kiểm tra `src/components/ui/Button.tsx`, nếu chưa thì thêm vào khi implement.

- [ ] **Step 3: Sidebar.tsx — NotesPane** — thêm filter + render section. Trong `NotesPane`:

```tsx
  const folderFilter = useUi((s) => s.folderFilter);
  // …
  const visible = notes
    .filter((n) => (folderFilter ? (n.folder ?? "").toLowerCase() === folderFilter.toLowerCase() : true))
    .filter((n) => (tagFilter ? n.tags.includes(tagFilter) : true));
```

Và JSX giữa SearchField div và `<TagFilterRow />`:

```tsx
      <FolderSection />
```

(import `FolderSection` từ `../notes/FolderSection`).

- [ ] **Step 4: Component test** — `src/components/notes/FolderSection.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FolderSection } from "./FolderSection";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";

vi.mock("../../lib/api/notes", () => ({
  api: {
    notes: {
      moveToFolder: vi.fn(async () => ({ id: "x", title: "", tags: [], pinned: false, folder: null, created: "", updated: "", snippet: "", wordCount: 0, body: "" })),
      list: vi.fn(async () => []),
      tags: vi.fn(async () => []),
    },
    folders: {
      list: vi.fn(async () => ["Work"]),
      create: vi.fn(async (name: string) => [name]),
      rename: vi.fn(async (_o: string, n: string) => ({ folders: [n], moved: 1 })),
      del: vi.fn(async () => ({ folders: [], moved: 1 })),
    },
  },
}));

import { api } from "../../lib/api/notes";

const meta = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "n1", title: "A", tags: [], pinned: false, folder: null,
  created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z", snippet: "", wordCount: 0,
  ...over,
});

describe("FolderSection", () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: [meta({ id: "n1", folder: "Work" }), meta({ id: "n2" })], folders: ["Work"], tags: [] });
    useUi.setState({ folderFilter: null });
    vi.clearAllMocks();
  });

  it("renders folder rows with counts and toggles the filter on click", () => {
    render(<FolderSection />);
    expect(screen.getByLabelText("Thư mục Work, 1 ghi chú")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Thư mục Work, 1 ghi chú"));
    expect(useUi.getState().folderFilter).toBe("Work");
    fireEvent.click(screen.getByLabelText("Thư mục Work, 1 ghi chú"));
    expect(useUi.getState().folderFilter).toBeNull();
  });

  it("creates a folder via the inline input", async () => {
    render(<FolderSection />);
    fireEvent.click(screen.getByLabelText("Thư mục mới"));
    const input = screen.getByLabelText("Tên thư mục");
    fireEvent.change(input, { target: { value: "Life" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(api.folders.create).toHaveBeenCalledWith("Life");
  });

  it("rejects duplicate folder names with a toast, without calling the api", () => {
    render(<FolderSection />);
    fireEvent.click(screen.getByLabelText("Thư mục mới"));
    const input = screen.getByLabelText("Tên thư mục");
    fireEvent.change(input, { target: { value: "work" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(api.folders.create).not.toHaveBeenCalled();
    expect(useUi.getState().toasts[0].message).toContain("đã tồn tại");
  });

  it("clears a stale folderFilter when the folder disappears", () => {
    useUi.setState({ folderFilter: "Gone" });
    render(<FolderSection />);
    expect(useUi.getState().folderFilter).toBeNull();
  });
});
```

- [ ] **Step 5: Chạy test**

Run: `npm test -- FolderSection`
Expected: PASS (sửa nhỏ nếu selector lệch — giữ assertion tiếng Việt).

- [ ] **Step 6: Commit**

```bash
git add src/components/notes/FolderSection.tsx src/components/notes/FolderSection.test.tsx src/components/layout/Sidebar.tsx src/i18n/sidebar.ts
git commit -m "feat(sidebar): folder section with create/rename/delete and folder filter"
```

---

### Task 6: MoveNoteDialog + menu item trên NoteItem

**Files:**
- Create: `src/components/notes/MoveNoteDialog.tsx`
- Create: `src/components/notes/MoveNoteDialog.test.tsx`
- Modify: `src/components/notes/NoteItem.tsx` (prop `onMove`)
- Modify: `src/components/notes/NoteList.tsx` (thread `onMove`)
- Modify: `src/components/layout/Sidebar.tsx` (NotesPane giữ state `moveTarget` + render dialog)

**Interfaces:**
- Consumes: Task 4 `moveNoteToFolder`, Task 5 i18n keys.
- Produces: `<MoveNoteDialog note={NoteMeta | null} onClose={(): void} />`; `NoteItem`/`NoteList` prop mới `onMove?: (id: string) => void`.

- [ ] **Step 1: MoveNoteDialog.tsx** — file mới:

```tsx
import { Check, Folder } from "lucide-react";
import type { NoteMeta } from "../../lib/api/notes";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { Overlay } from "../ui/Dialog";

interface MoveNoteDialogProps {
  note: NoteMeta | null;
  onClose: () => void;
}

/** Modal list of folders (+ "no folder") — picking one moves the note, with Undo toast. */
export function MoveNoteDialog({ note, onClose }: MoveNoteDialogProps) {
  const t = useT();
  const folders = useNotesStore((s) => s.folders);
  const moveNoteToFolder = useNotesStore((s) => s.moveNoteToFolder);
  const pushToast = useUi((s) => s.pushToast);

  if (!note) return null;

  const pick = async (folder: string | null) => {
    const target = note.id;
    onClose();
    const prev = await moveNoteToFolder(target, folder);
    if (prev === "error") {
      pushToast({ message: t("sidebar.moveFailed"), durationMs: 5000 });
      return;
    }
    if (prev === folder) return;
    const label = folder ?? t("sidebar.noFolder");
    pushToast({
      message: t("sidebar.movedToFolder", { name: label }),
      actionLabel: t("sidebar.undo"),
      durationMs: 8000,
      onAction: () => void moveNoteToFolder(target, prev),
    });
  };

  const options: { name: string | null; label: string }[] = [
    { name: null, label: t("sidebar.noFolder") },
    ...folders.map((f) => ({ name: f, label: f })),
  ];
  const selected = (name: string | null) =>
    name === null ? note.folder === null : (note.folder ?? "").toLowerCase() === name.toLowerCase();

  return (
    <Overlay open onClose={onClose} label={t("sidebar.moveToFolderTitle", { title: note.title })} className="w-[320px]">
      <div className="max-h-[60vh] overflow-y-auto p-2" role="listbox" aria-label={t("sidebar.moveToFolder")}>
        <p className="px-2.5 pb-1.5 pt-1.5 text-footnote font-semibold text-fg-secondary">
          {t("sidebar.moveToFolderTitle", { title: note.title })}
        </p>
        {options.map(({ name, label }) => (
          <button
            key={name ?? "__root"}
            type="button"
            role="option"
            aria-selected={selected(name)}
            onClick={() => void pick(name)}
            className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-callout text-fg transition-colors hover:bg-hover"
          >
            <Folder size={15} aria-hidden="true" className="shrink-0 text-fg-secondary" />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {selected(name) && <Check size={15} aria-hidden="true" className="shrink-0 text-fg" />}
          </button>
        ))}
      </div>
    </Overlay>
  );
}
```

(Giữ `cn` import chỉ nếu dùng — xoá nếu không dùng.)

- [ ] **Step 2: NoteItem.tsx** — props thêm `onMove?: (id: string) => void;`, `hasActions` thành `Boolean(onDelete || onTogglePin || onMove)`; thêm MenuItem sau Pin (trước separator/delete):

```tsx
            {onMove && (
              <MenuItem icon={<FolderInput size={14} />} onSelect={() => onMove(note.id)}>
                {t("sidebar.moveToFolder")}
              </MenuItem>
            )}
```

(import `FolderInput` từ lucide-react; nếu `onTogglePin` vắng mà `onMove` có thì vẫn hiện — separator logic: `<MenuSeparator />` render khi có ít nhất 2 mục — sửa điều kiện separator thành `{(onTogglePin || onMove) && onDelete && <MenuSeparator />}`.)

- [ ] **Step 3: NoteList.tsx** — prop mới `onMove?: (id: string) => void`, thread vào `NoteItem` trong `renderItem`.

- [ ] **Step 4: Sidebar.tsx NotesPane** — state + render:

```tsx
  const [moveTarget, setMoveTarget] = useState<NoteMeta | null>(null);
  // …
  <NoteList
    /* props hiện có */
    onMove={(id) => setMoveTarget(notes.find((n) => n.id === id) ?? null)}
  />
  <MoveNoteDialog note={moveTarget} onClose={() => setMoveTarget(null)} />
```

(import `MoveNoteDialog`, type `NoteMeta`, `useState` đã có sẵn trong file.)

- [ ] **Step 5: MoveNoteDialog.test.tsx** — file mới:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MoveNoteDialog } from "./MoveNoteDialog";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";

vi.mock("../../lib/api/notes", () => ({
  api: {
    notes: {
      moveToFolder: vi.fn(async () => ({ id: "x", title: "", tags: [], pinned: false, folder: null, created: "", updated: "", snippet: "", wordCount: 0, body: "" })),
    },
    folders: { list: vi.fn(async () => ["Work", "Life"]) },
  },
}));

const meta = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "n1", title: "Ghi chú A", tags: [], pinned: false, folder: null,
  created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z", snippet: "", wordCount: 0,
  ...over,
});

describe("MoveNoteDialog", () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: [meta()], folders: ["Work", "Life"], tags: [] });
    useUi.setState({ toasts: [] });
    vi.clearAllMocks();
  });

  it("lists folders and marks the current one selected", () => {
    render(<MoveNoteDialog note={meta({ folder: "Work" })} onClose={() => {}} />);
    expect(screen.getByRole("option", { name: /Work/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /Không có thư mục/ })).toHaveAttribute("aria-selected", "false");
  });

  it("picks a folder, closes, and toasts with Undo restoring the previous folder", async () => {
    const onClose = vi.fn();
    render(<MoveNoteDialog note={meta()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("option", { name: /Work/ }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useNotesStore.getState().notes[0].folder).toBe("Work");
    const toast = useUi.getState().toasts[0];
    expect(toast.message).toContain("Đã chuyển tới");
    toast.onAction?.();
    await vi.waitFor(() => expect(useNotesStore.getState().notes[0].folder).toBeNull());
  });

  it("renders nothing when note is null", () => {
    const { container } = render(<MoveNoteDialog note={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 6: Chạy test toàn bộ front-end**

Run: `npm test`
Expected: PASS — nếu `NoteList.test.tsx` cũ fail vì props/interface đổi, cập nhật fixture `meta()` thêm `folder: null`.

- [ ] **Step 7: Commit**

```bash
git add src/components/notes/MoveNoteDialog.tsx src/components/notes/MoveNoteDialog.test.tsx src/components/notes/NoteItem.tsx src/components/notes/NoteList.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(notes): move note to folder via dialog + row menu item"
```

---

### Task 7: Kiểm thử tổng + dọn dẹp

**Files:** không tạo/sửa file trừ khi test fail phát hiện lỗi.

- [ ] **Step 1: Rust full test**

Run: `cd src-tauri && cargo test`
Expected: PASS toàn bộ.

- [ ] **Step 2: Front-end full test + typecheck**

Run: `npm test`
Run: `npm run build` (hoặc `npx tsc --noEmit` nếu build nặng)
Expected: PASS, không lỗi TS.

- [ ] **Step 3: Kiểm tra thủ công (nếu có môi trường chạy `npm run tauri dev`):** tạo folder → tạo note trong folder view → rename → delete folder (note về root) → move qua menu note → filter kết hợp tag. Không bắt buộc trong plan này (dev app chạy riêng).

- [ ] **Step 4: Commit cuối (nếu có sửa)**

```bash
git add -A && git commit -m "test: folder feature integration fixes"
```
