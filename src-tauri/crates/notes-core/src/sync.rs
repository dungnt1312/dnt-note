use crate::note_file;
use crate::note::Note;
use chrono::DateTime;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct SyncReport {
    /// Files copied from notes_dir → target_dir.
    pub copied_out: usize,
    /// Files copied from target_dir → notes_dir.
    pub copied_in: usize,
    /// Conflicts resolved by copying (newer-wins) — counted on the winning side.
    pub resolved: usize,
}

/// Mirror `.md` notes two-way between the notes dir and a sync folder
/// (e.g. OneDrive). Missing on one side → copy there; present on both →
/// newer `updated` frontmatter wins; unparseable side loses to parseable one.
pub fn mirror(notes_dir: &Path, target_dir: &Path) -> std::io::Result<SyncReport> {
    fs::create_dir_all(notes_dir)?;
    fs::create_dir_all(target_dir)?;
    let mut report = SyncReport::default();

    let local = scan(notes_dir)?;
    let remote = scan(target_dir)?;

    // Collect the union of ids.
    let mut ids: Vec<String> = local.keys().cloned().collect();
    for id in remote.keys() {
        if !ids.contains(id) {
            ids.push(id.clone());
        }
    }

    for id in ids {
        let local_path = notes_dir.join(format!("{}.md", id));
        let remote_path = target_dir.join(format!("{}.md", id));
        let in_local = local.get(&id);
        let in_remote = remote.get(&id);
        match (in_local, in_remote) {
            (Some(_), None) => {
                fs::copy(&local_path, &remote_path)?;
                report.copied_out += 1;
            }
            (None, Some(_)) => {
                fs::copy(&remote_path, &local_path)?;
                report.copied_in += 1;
            }
            (Some(l), Some(r)) => {
                if files_differ(&local_path, &remote_path)? {
                    match pick_winner(l, r) {
                        Side::Local => {
                            fs::copy(&local_path, &remote_path)?;
                            report.resolved += 1;
                        }
                        Side::Remote => {
                            fs::copy(&remote_path, &local_path)?;
                            report.resolved += 1;
                        }
                        Side::Tie => {} // identical timestamps — leave both
                    }
                }
            }
            (None, None) => unreachable!(),
        }
    }
    Ok(report)
}

/// Copy attachment files missing on either side. Existing files are never
/// overwritten (names are uuid-prefixed, so same name means same file).
/// Returns number of files copied.
pub fn mirror_attachments(local: &Path, remote: &Path) -> std::io::Result<usize> {
    fs::create_dir_all(local)?;
    fs::create_dir_all(remote)?;
    Ok(copy_missing(local, remote)? + copy_missing(remote, local)?)
}

fn copy_missing(from: &Path, to: &Path) -> std::io::Result<usize> {
    let mut n = 0;
    for entry in fs::read_dir(from)?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name() else { continue };
        let dest = to.join(name);
        if !dest.exists() {
            fs::copy(&path, &dest)?;
            n += 1;
        }
    }
    Ok(n)
}

#[derive(PartialEq)]
enum Side {
    Local,
    Remote,
    Tie,
}

fn files_differ(a: &Path, b: &Path) -> std::io::Result<bool> {
    let sa = fs::read_to_string(a).unwrap_or_default();
    let sb = fs::read_to_string(b).unwrap_or_default();
    Ok(sa != sb)
}

fn pick_winner(local: &Option<Note>, remote: &Option<Note>) -> Side {
    let local_ok = local.is_some();
    let remote_ok = remote.is_some();
    match (local_ok, remote_ok) {
        (true, false) => Side::Local,
        (false, true) => Side::Remote,
        (true, true) => {
            let lt = local.as_ref().unwrap().updated;
            let rt = remote.as_ref().unwrap().updated;
            if lt > rt {
                Side::Local
            } else if rt > lt {
                Side::Remote
            } else {
                Side::Tie
            }
        }
        (false, false) => Side::Tie, // both corrupt — leave untouched
    }
}

/// Scan a dir for parseable `.md` notes: id → parsed Note (None when corrupt).
fn scan(dir: &Path) -> std::io::Result<HashMap<String, Option<Note>>> {
    let mut map = HashMap::new();
    for entry in fs::read_dir(dir)?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let parsed = fs::read_to_string(&path)
            .ok()
            .and_then(|c| note_file::parse(&c).ok());
        map.insert(stem.to_string(), parsed);
    }
    Ok(map)
}

#[allow(dead_code)]
fn _timestamp(_: DateTime<chrono::Utc>) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::note::NotePatch;
    use crate::store::NotesStore;
    use tempfile::TempDir;

    fn setup_pair() -> (TempDir, NotesStore, std::path::PathBuf) {
        let tmp = TempDir::new().unwrap();
        let notes_dir = tmp.path().join("notes");
        let store = NotesStore::new(notes_dir.clone()).unwrap();
        let target = tmp.path().join("onedrive");
        (tmp, store, target)
    }

    #[test]
    fn copies_local_notes_to_empty_target() {
        let (_tmp, mut store, target) = setup_pair();
        store.create("Một", "body", vec![]).unwrap();
        let report = mirror(store.notes_dir(), &target).unwrap();
        assert_eq!(report.copied_out, 1);
        assert_eq!(report.copied_in, 0);
        assert!(target.join(store.list()[0].id.clone() + ".md").exists());
    }

    #[test]
    fn copies_remote_notes_into_empty_local() {
        let (_tmp, store, target) = setup_pair();
        std::fs::create_dir_all(&target).unwrap();
        // A note that exists only in the sync folder.
        let raw = "---\nid: remote-1\ntitle: Từ cloud\ntags: []\npinned: false\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n---\nhello cloud";
        std::fs::write(target.join("remote-1.md"), raw).unwrap();
        let report = mirror(store.notes_dir(), &target).unwrap();
        assert_eq!(report.copied_in, 1);
        assert!(store.notes_dir().join("remote-1.md").exists());
    }

    #[test]
    fn newer_wins_on_conflict_both_directions() {
        let (_tmp, mut store, target) = setup_pair();
        let note = store.create("Gốc", "v1", vec![]).unwrap();
        mirror(store.notes_dir(), &target).unwrap();

        // Local edit becomes newer → copied out.
        std::thread::sleep(std::time::Duration::from_millis(10));
        store
            .update(&note.id, NotePatch { body: Some("local newer".into()), ..Default::default() })
            .unwrap();
        let report = mirror(store.notes_dir(), &target).unwrap();
        assert_eq!(report.resolved, 1);
        let remote_text = std::fs::read_to_string(target.join(format!("{}.md", note.id))).unwrap();
        assert!(remote_text.contains("local newer"));

        // Remote edit becomes newer → copied back.
        std::thread::sleep(std::time::Duration::from_millis(10));
        let mut remote_note = note_file::parse(&std::fs::read_to_string(target.join(format!("{}.md", note.id))).unwrap()).unwrap();
        remote_note.body = "remote newer".into();
        remote_note.updated = chrono::Utc::now();
        std::fs::write(target.join(format!("{}.md", note.id)), note_file::serialize(&remote_note)).unwrap();
        let report = mirror(store.notes_dir(), &target).unwrap();
        assert_eq!(report.resolved, 1);
        let local_text = std::fs::read_to_string(store.notes_dir().join(format!("{}.md", note.id))).unwrap();
        assert!(local_text.contains("remote newer"));
    }

    #[test]
    fn corrupt_remote_loses_to_parseable_local() {
        let (_tmp, mut store, target) = setup_pair();
        let note = store.create("Ổn định", "body", vec![]).unwrap();
        mirror(store.notes_dir(), &target).unwrap();
        // Corrupt the remote copy.
        std::fs::write(target.join(format!("{}.md", note.id)), "garbage without frontmatter").unwrap();
        let report = mirror(store.notes_dir(), &target).unwrap();
        assert_eq!(report.resolved, 1);
        let remote_text = std::fs::read_to_string(target.join(format!("{}.md", note.id))).unwrap();
        assert!(remote_text.contains("Ổn định"));
    }

    #[test]
    fn mirror_attachments_copies_both_ways_without_overwrite() {
        let tmp = TempDir::new().unwrap();
        let local = tmp.path().join("local");
        let remote = tmp.path().join("remote");
        std::fs::create_dir_all(&local).unwrap();
        std::fs::create_dir_all(&remote).unwrap();
        std::fs::write(local.join("a.png"), "A").unwrap();
        std::fs::write(remote.join("b.pdf"), "B").unwrap();
        std::fs::write(local.join("same.txt"), "local").unwrap();
        std::fs::write(remote.join("same.txt"), "remote").unwrap();
        assert_eq!(mirror_attachments(&local, &remote).unwrap(), 2);
        assert_eq!(std::fs::read_to_string(remote.join("a.png")).unwrap(), "A");
        assert_eq!(std::fs::read_to_string(local.join("b.pdf")).unwrap(), "B");
        assert_eq!(std::fs::read_to_string(local.join("same.txt")).unwrap(), "local");
        assert_eq!(std::fs::read_to_string(remote.join("same.txt")).unwrap(), "remote");
        assert_eq!(mirror_attachments(&local, &remote).unwrap(), 0);
    }

    #[test]
    fn identical_notes_are_untouched() {
        let (_tmp, mut store, target) = setup_pair();
        store.create("Same", "same", vec![]).unwrap();
        mirror(store.notes_dir(), &target).unwrap();
        let report = mirror(store.notes_dir(), &target).unwrap();
        assert_eq!(report, SyncReport::default());
    }
}
