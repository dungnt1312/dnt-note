use crate::error::{NoteError, Result};
use crate::folders::{eq_ci, FolderRegistry};
use crate::note::{Note, NoteMeta, NotePatch, Stats};
use crate::note_file;
use chrono::Utc;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// File-based notes store. In-memory index of `NoteMeta`, rebuilt via
/// `reload()` (called on init and whenever the watcher reports changes).
pub struct NotesStore {
    dir: PathBuf,
    trash_dir: PathBuf,
    folders: FolderRegistry,
    index: HashMap<String, NoteMeta>,
}

impl NotesStore {
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

    pub fn notes_dir(&self) -> &Path {
        &self.dir
    }

    /// Re-scan the notes directory. Corrupt files stay visible with a
    /// fallback title instead of disappearing.
    pub fn reload(&mut self) {
        self.index.clear();
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            match self.load_note_from(&path) {
                Ok(note) => {
                    self.index.insert(note.id.clone(), NoteMeta::from(&note));
                }
                Err(_) => {
                    // Raw fallback so the note is still visible and its data
                    // on disk is never silently lost.
                    let now = Utc::now();
                    self.index.insert(
                        name.to_string(),
                        NoteMeta {
                            id: name.to_string(),
                            title: format!("⚠ {}", name),
                            tags: vec![],
                            pinned: false,
                            folder: None,
                            created: now,
                            updated: now,
                            snippet: "(file frontmatter lỗi — sửa trực tiếp trong file .md)"
                                .into(),
                            word_count: 0,
                        },
                    );
                }
            }
        }
    }

    pub fn list(&self) -> Vec<NoteMeta> {
        let mut items: Vec<NoteMeta> = self.index.values().cloned().collect();
        items.sort_by(|a, b| {
            b.pinned
                .cmp(&a.pinned)
                .then(b.updated.cmp(&a.updated))
                .then(a.title.to_lowercase().cmp(&b.title.to_lowercase()))
        });
        items
    }

    pub fn read(&self, id: &str) -> Result<Note> {
        let path = self.file_of(id);
        self.load_note_from(&path)
    }

    pub fn create(
        &mut self,
        title: &str,
        body: &str,
        tags: Vec<String>,
        folder: Option<String>,
    ) -> Result<Note> {
        let now = Utc::now();
        let note = Note {
            id: new_id(),
            title: title.trim().to_string(),
            tags,
            pinned: false,
            folder,
            created: now,
            updated: now,
            body: body.to_string(),
        };
        self.write_note(&note)?;
        self.index.insert(note.id.clone(), NoteMeta::from(&note));
        Ok(note)
    }

    pub fn update(&mut self, id: &str, patch: NotePatch) -> Result<Note> {
        let mut note = self.read(id)?;
        // Corrupt files aren't in the index as real notes; forbid blind edits
        // until the user fixes the file, otherwise we'd overwrite their data.
        if !self.index.contains_key(id) {
            return Err(NoteError::NotFound(id.to_string()));
        }
        if let Some(t) = patch.title {
            note.title = t.trim().to_string();
        }
        if let Some(b) = patch.body {
            note.body = b;
        }
        if let Some(t) = patch.tags {
            note.tags = t;
        }
        if let Some(p) = patch.pinned {
            note.pinned = p;
        }
        note.updated = Utc::now();
        self.write_note(&note)?;
        self.index.insert(note.id.clone(), NoteMeta::from(&note));
        Ok(note)
    }

    /// Move the note file into `.trash/` (recoverable).
    pub fn delete(&mut self, id: &str) -> Result<()> {
        let src = self.file_of(id);
        if !src.exists() {
            return Err(NoteError::NotFound(id.to_string()));
        }
        let dest = self.trash_dir.join(format!("{}.md", id));
        if dest.exists() {
            fs::remove_file(&dest)?;
        }
        fs::rename(&src, &dest)?;
        self.index.remove(id);
        Ok(())
    }

    /// Move a note back out of `.trash/`, bumping its `updated` stamp.
    pub fn restore(&mut self, id: &str) -> Result<Note> {
        let src = self.trash_dir.join(format!("{}.md", id));
        if !src.exists() {
            return Err(NoteError::NotFound(id.to_string()));
        }
        let dest = self.file_of(id);
        fs::rename(&src, &dest)?;
        let mut note = self.load_note_from(&dest)?;
        note.updated = Utc::now();
        self.write_note(&note)?;
        self.index.insert(note.id.clone(), NoteMeta::from(&note));
        Ok(note)
    }

    /// Case-insensitive substring search over title + body. Title matches
    /// rank above body-only matches. Reads full files — fine at note-app scale.
    pub fn search(&self, query: &str, limit: usize) -> Vec<NoteMeta> {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return vec![];
        }
        let mut scored: Vec<(bool, NoteMeta)> = Vec::new();
        for meta in self.list() {
            if meta.title.to_lowercase().contains(&q) {
                scored.push((true, meta));
                continue;
            }
            if let Ok(note) = self.read(&meta.id) {
                if note.body.to_lowercase().contains(&q) {
                    scored.push((false, meta));
                }
            }
        }
        scored.sort_by(|a, b| b.0.cmp(&a.0));
        scored.into_iter().map(|(_, m)| m).take(limit).collect()
    }

    pub fn tags(&self) -> Vec<(String, usize)> {
        let mut counts: HashMap<String, usize> = HashMap::new();
        for meta in self.index.values() {
            for tag in &meta.tags {
                *counts.entry(tag.clone()).or_default() += 1;
            }
        }
        let mut out: Vec<(String, usize)> = counts.into_iter().collect();
        out.sort();
        out
    }

    pub fn stats(&self) -> Stats {
        let items = self.list();
        Stats {
            total: items.len(),
            pinned: items.iter().filter(|n| n.pinned).count(),
            words: self
                .index
                .values()
                .map(|m| m.word_count as u64)
                .sum(),
            tags: self.tags().len(),
        }
    }

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
            return Err(NoteError::Unknown(format!(
                "folder already exists: {name}"
            )));
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
            return Err(NoteError::Unknown(format!(
                "folder already exists: {new}"
            )));
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

    /// Permanently delete everything in `.trash/`. Returns file count.
    pub fn empty_trash(&self) -> usize {
        let mut n = 0;
        if let Ok(entries) = fs::read_dir(&self.trash_dir) {
            for entry in entries.flatten() {
                if entry.path().is_file() && fs::remove_file(entry.path()).is_ok() {
                    n += 1;
                }
            }
        }
        n
    }

    /// Names referenced as `(attachments/<name>)` across every `.md` file in
    /// the notes dir and `.trash/`. Raw text is scanned so trashed and
    /// unparseable notes still keep their attachments alive.
    pub fn attachment_refs(&self) -> std::collections::HashSet<String> {
        let mut refs = std::collections::HashSet::new();
        for dir in [&self.dir, &self.trash_dir] {
            let Ok(entries) = fs::read_dir(dir) else { continue };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                if let Ok(text) = fs::read_to_string(&path) {
                    refs.extend(crate::attachments::refs_in_body(&text));
                }
            }
        }
        refs
    }

    /// Read at most `max_chars` characters of the body starting at
    /// `char_offset` (for MCP reads of long notes). Returns (text, total_chars).
    pub fn read_body_range(&self, id: &str, char_offset: usize, max_chars: usize) -> Result<(String, usize)> {
        let note = self.read(id)?;
        let total = note.body.chars().count();
        let text: String = note
            .body
            .chars()
            .skip(char_offset)
            .take(max_chars.max(1))
            .collect();
        Ok((text, total))
    }

    fn file_of(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{}.md", id))
    }

    fn load_note_from(&self, path: &Path) -> Result<Note> {
        let contents = fs::read_to_string(path)?;
        note_file::parse(&contents)
    }

    fn write_note(&self, note: &Note) -> Result<()> {
        let contents = note_file::serialize(note);
        write_atomic(&self.file_of(&note.id), contents.as_bytes())?;
        Ok(())
    }
}

/// Atomic write: temp file in the same directory, then rename over the target.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, NotesStore) {
        let tmp = TempDir::new().unwrap();
        let store = NotesStore::new(
            tmp.path().join("notes"),
            tmp.path().join("folders.json"),
        )
        .unwrap();
        (tmp, store)
    }

    #[test]
    fn create_and_list_roundtrip() {
        let (_tmp, mut store) = setup();
        let note = store
            .create("Tiếng Việt 123", "nội dung body", vec!["tag1".into()], None)
            .unwrap();
        let list = store.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "Tiếng Việt 123");
        assert_eq!(list[0].snippet, "nội dung body");
        assert_eq!(store.read(&note.id).unwrap().body, "nội dung body");
    }

    #[test]
    fn update_changes_fields_and_timestamp() {
        let (_tmp, mut store) = setup();
        let note = store.create("t", "b", vec![], None).unwrap();
        let before = note.updated;
        let updated = store
            .update(&note.id, NotePatch { title: Some("t2".into()), pinned: Some(true), ..Default::default() })
            .unwrap();
        assert_eq!(updated.title, "t2");
        assert!(updated.pinned);
        assert!(updated.updated >= before);
        assert_eq!(updated.created, note.created);
    }

    #[test]
    fn attachment_refs_include_trash_and_corrupt_files() {
        let (_tmp, mut store) = setup();
        store.create("live", "![a](attachments/live.png)", vec![], None).unwrap();
        let trashed = store.create("t", "![a](attachments/trashed (1).png)", vec![], None).unwrap();
        store.delete(&trashed.id).unwrap();
        fs::write(store.dir.join("broken.md"), "no frontmatter [f](attachments/corrupt.pdf)").unwrap();
        store.reload();
        let refs = store.attachment_refs();
        assert!(refs.contains("live.png"));
        assert!(refs.contains("trashed (1).png"));
        assert!(refs.contains("corrupt.pdf"));
    }

    #[test]
    fn delete_moves_to_trash_and_restore() {
        let (_tmp, mut store) = setup();
        let note = store.create("t", "b", vec![], None).unwrap();
        store.delete(&note.id).unwrap();
        assert!(store.list().is_empty());
        assert!(store.trash_dir.join(format!("{}.md", note.id)).exists());
        let restored = store.restore(&note.id).unwrap();
        assert_eq!(restored.id, note.id);
        assert_eq!(store.list().len(), 1);
        assert!(!store.trash_dir.join(format!("{}.md", note.id)).exists());
    }

    #[test]
    fn search_matches_title_and_body_case_insensitive() {
        let (_tmp, mut store) = setup();
        store.create("Tiếng Việt", "nội dung", vec![], None).unwrap();
        store.create("other", "học tiếng", vec![], None).unwrap();
        assert_eq!(store.search("việt", 10).len(), 1); // title match
        assert_eq!(store.search("TIẾNG", 10).len(), 2); // title + body
        assert!(store.search("   ", 10).is_empty());
    }

    #[test]
    fn search_ranks_title_above_body() {
        let (_tmp, mut store) = setup();
        store.create("aaa", "no match here", vec![], None).unwrap();
        store.create("zzz", "aaa in body", vec![], None).unwrap();
        let results = store.search("aaa", 10);
        assert_eq!(results[0].title, "aaa");
    }

    #[test]
    fn list_orders_pinned_first_then_updated_desc() {
        let (_tmp, mut store) = setup();
        let a = store.create("a", "", vec![], None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let b = store.create("b", "", vec![], None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        store.create("c", "", vec![], None).unwrap();
        store.update(&a.id, NotePatch { pinned: Some(true), ..Default::default() }).unwrap();
        let titles: Vec<String> = store.list().into_iter().map(|n| n.title).collect();
        assert_eq!(titles, vec!["a", "c", "b"]); // pinned first, then newest
        let _ = b;
    }

    #[test]
    fn tags_counts_and_stats() {
        let (_tmp, mut store) = setup();
        store.create("a", "one two", vec!["work".into(), "life".into()], None).unwrap();
        store.create("b", "three", vec!["work".into()], None).unwrap();
        store.update(&store.list()[0].id, NotePatch { pinned: Some(true), ..Default::default() }).unwrap();
        assert_eq!(store.tags(), vec![("life".to_string(), 1), ("work".to_string(), 2)]);
        let stats = store.stats();
        assert_eq!(stats.total, 2);
        assert_eq!(stats.pinned, 1);
        assert_eq!(stats.words, 3);
        assert_eq!(stats.tags, 2);
    }

    #[test]
    fn corrupt_file_listed_with_fallback_title() {
        let (tmp, mut store) = setup();
        fs::write(tmp.path().join("notes/broken.md"), "no frontmatter at all").unwrap();
        store.reload();
        let list = store.list();
        assert_eq!(list.len(), 1);
        assert!(list[0].title.starts_with("⚠"));
        assert_eq!(list[0].id, "broken");
    }

    #[test]
    fn reload_picks_up_external_changes() {
        let (tmp, mut store) = setup();
        let note = store.create("orig title", "b", vec![], None).unwrap();
        let path = tmp.path().join("notes").join(format!("{}.md", note.id));
        // Overwrite on disk behind the store's back.
        let raw = fs::read_to_string(&path).unwrap().replace("orig", "external");
        fs::write(&path, raw).unwrap();
        store.reload();
        assert_eq!(store.list()[0].title, "external title");
    }

    #[test]
    fn empty_trash_deletes_trash_files() {
        let (tmp, mut store) = setup();
        let a = store.create("a", "", vec![], None).unwrap();
        let b = store.create("b", "", vec![], None).unwrap();
        store.delete(&a.id).unwrap();
        store.delete(&b.id).unwrap();
        fs::write(tmp.path().join("notes/.trash/stray.md"), "x").unwrap();
        assert_eq!(store.empty_trash(), 3);
        assert_eq!(store.empty_trash(), 0);
    }

    #[test]
    fn attachment_refs_scans_all_bodies() {
        let (_tmp, mut store) = setup();
        store
            .create("a", "![x](attachments/k1.png) [f](attachments/k2.pdf)", vec![], None)
            .unwrap();
        store.create("b", "no refs here", vec![], None).unwrap();
        let refs = store.attachment_refs();
        assert!(refs.contains("k1.png"));
        assert!(refs.contains("k2.pdf"));
        assert_eq!(refs.len(), 2);
    }

    #[test]
    fn read_body_range_slices_unicode_safely() {
        let (_tmp, mut store) = setup();
        let note = store.create("Đô", "àáạbcdefghijklmnop", vec![], None).unwrap();
        let (slice, total) = store.read_body_range(&note.id, 0, 4).unwrap();
        assert_eq!(slice, "àáạb");
        assert_eq!(total, 18);
        let (slice2, _) = store.read_body_range(&note.id, 15, 100).unwrap();
        assert_eq!(slice2, "nop");
        let (slice3, _) = store.read_body_range(&note.id, 0, 0).unwrap();
        assert_eq!(slice3.chars().count(), 1); // max 0 clamps to 1
    }

    #[test]
    fn folder_crud_and_union_listing() {
        let (_tmp, mut store) = setup();
        store.create_folder("Work").unwrap();
        // Union: registry + folder on a note that the registry doesn't know.
        let n = store
            .create("Cloud note", "b", vec![], Some("Từ cloud".into()))
            .unwrap();
        assert_eq!(
            store.list_folders(),
            vec!["Từ cloud".to_string(), "Work".to_string()]
        );
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
        let mut store =
            NotesStore::new(tmp.path().join("notes"), tmp.path().join("folders.json")).unwrap();
        store.create_folder("Lâu dài").unwrap();
        drop(store);
        let store2 =
            NotesStore::new(tmp.path().join("notes"), tmp.path().join("folders.json")).unwrap();
        assert!(store2.list_folders().contains(&"Lâu dài".to_string()));
    }

    #[test]
    fn reload_fallback_meta_has_no_folder() {
        let (tmp, mut store) = setup();
        fs::write(tmp.path().join("notes/broken.md"), "no frontmatter").unwrap();
        store.reload();
        assert_eq!(store.list()[0].folder, None);
    }
}
