use crate::error::{NoteError, Result};
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
    index: HashMap<String, NoteMeta>,
}

impl NotesStore {
    pub fn new(notes_dir: PathBuf) -> std::io::Result<Self> {
        let trash_dir = notes_dir.join(".trash");
        fs::create_dir_all(&trash_dir)?;
        let mut store = NotesStore {
            dir: notes_dir,
            trash_dir,
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

    pub fn create(&mut self, title: &str, body: &str, tags: Vec<String>) -> Result<Note> {
        let now = Utc::now();
        let note = Note {
            id: new_id(),
            title: title.trim().to_string(),
            tags,
            pinned: false,
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

    /// Names referenced as `(attachments/<name>)` across all note bodies.
    pub fn attachment_refs(&self) -> std::collections::HashSet<String> {
        let mut refs = std::collections::HashSet::new();
        for id in self.index.keys() {
            if let Ok(note) = self.read(id) {
                refs.extend(crate::attachments::refs_in_body(&note.body));
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
    let tmp = path.with_extension("md.tmp");
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
        let store = NotesStore::new(tmp.path().join("notes")).unwrap();
        (tmp, store)
    }

    #[test]
    fn create_and_list_roundtrip() {
        let (_tmp, mut store) = setup();
        let note = store
            .create("Tiếng Việt 123", "nội dung body", vec!["tag1".into()])
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
        let note = store.create("t", "b", vec![]).unwrap();
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
    fn delete_moves_to_trash_and_restore() {
        let (_tmp, mut store) = setup();
        let note = store.create("t", "b", vec![]).unwrap();
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
        store.create("Tiếng Việt", "nội dung", vec![]).unwrap();
        store.create("other", "học tiếng", vec![]).unwrap();
        assert_eq!(store.search("việt", 10).len(), 1); // title match
        assert_eq!(store.search("TIẾNG", 10).len(), 2); // title + body
        assert!(store.search("   ", 10).is_empty());
    }

    #[test]
    fn search_ranks_title_above_body() {
        let (_tmp, mut store) = setup();
        store.create("aaa", "no match here", vec![]).unwrap();
        store.create("zzz", "aaa in body", vec![]).unwrap();
        let results = store.search("aaa", 10);
        assert_eq!(results[0].title, "aaa");
    }

    #[test]
    fn list_orders_pinned_first_then_updated_desc() {
        let (_tmp, mut store) = setup();
        let a = store.create("a", "", vec![]).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let b = store.create("b", "", vec![]).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        store.create("c", "", vec![]).unwrap();
        store.update(&a.id, NotePatch { pinned: Some(true), ..Default::default() }).unwrap();
        let titles: Vec<String> = store.list().into_iter().map(|n| n.title).collect();
        assert_eq!(titles, vec!["a", "c", "b"]); // pinned first, then newest
        let _ = b;
    }

    #[test]
    fn tags_counts_and_stats() {
        let (_tmp, mut store) = setup();
        store.create("a", "one two", vec!["work".into(), "life".into()]).unwrap();
        store.create("b", "three", vec!["work".into()]).unwrap();
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
        let note = store.create("orig title", "b", vec![]).unwrap();
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
        let a = store.create("a", "", vec![]).unwrap();
        let b = store.create("b", "", vec![]).unwrap();
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
            .create("a", "![x](attachments/k1.png) [f](attachments/k2.pdf)", vec![])
            .unwrap();
        store.create("b", "no refs here", vec![]).unwrap();
        let refs = store.attachment_refs();
        assert!(refs.contains("k1.png"));
        assert!(refs.contains("k2.pdf"));
        assert_eq!(refs.len(), 2);
    }

    #[test]
    fn read_body_range_slices_unicode_safely() {
        let (_tmp, mut store) = setup();
        let note = store.create("Đô", "àáạbcdefghijklmnop", vec![]).unwrap();
        let (slice, total) = store.read_body_range(&note.id, 0, 4).unwrap();
        assert_eq!(slice, "àáạb");
        assert_eq!(total, 18);
        let (slice2, _) = store.read_body_range(&note.id, 15, 100).unwrap();
        assert_eq!(slice2, "nop");
        let (slice3, _) = store.read_body_range(&note.id, 0, 0).unwrap();
        assert_eq!(slice3.chars().count(), 1); // max 0 clamps to 1
    }
}
