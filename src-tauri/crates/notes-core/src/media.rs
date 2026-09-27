use crate::attachments::{is_allowed, is_safe_name, refs_in_body};
use crate::error::{NoteError, Result};
use crate::note::NotePatch;
use crate::store::{write_atomic, NotesStore};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Image,
    Document,
    Audio,
    Other,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaUsage {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub name: String,
    pub display_name: String,
    pub ext: String,
    pub kind: MediaKind,
    pub size: u64,
    pub modified: DateTime<Utc>,
    pub used_by: Vec<MediaUsage>,
}

pub fn kind_of(ext: &str) -> MediaKind {
    match ext.to_lowercase().as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" => MediaKind::Image,
        "mp3" | "wav" | "webm" | "m4a" | "ogg" => MediaKind::Audio,
        "pdf" | "docx" | "rtf" | "odt" | "txt" | "md" | "csv" | "json" => MediaKind::Document,
        _ => MediaKind::Other,
    }
}

const UUID_LEN: usize = 36;

fn uuid_prefix(stored: &str) -> Option<&str> {
    let head = stored.get(..UUID_LEN)?;
    if stored.as_bytes().get(UUID_LEN) == Some(&b'-') && uuid::Uuid::parse_str(head).is_ok() {
        Some(head)
    } else {
        None
    }
}

/// Stored names are `<uuid36>-<original>`; this returns `<original>`.
pub fn display_name(stored: &str) -> String {
    match uuid_prefix(stored) {
        Some(_) => stored[UUID_LEN + 1..].to_string(),
        None => stored.to_string(),
    }
}

fn ext_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default()
}

fn validate_name(name: &str) -> Result<()> {
    if !is_safe_name(name) {
        return Err(NoteError::Unknown("Tên file không hợp lệ".into()));
    }
    Ok(())
}

/// (id, title, body) of every live (non-trash) note.
fn live_bodies(store: &NotesStore) -> Vec<(String, String, String)> {
    store
        .list()
        .into_iter()
        .filter_map(|m| store.read(&m.id).ok().map(|n| (n.id, n.title, n.body)))
        .collect()
}

/// All files in the attachments dir, newest first, with the live notes using each.
pub fn list_media(dir: &Path, store: &NotesStore) -> Result<Vec<MediaItem>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let notes: Vec<(String, String, Vec<String>)> = live_bodies(store)
        .into_iter()
        .map(|(id, title, body)| (id, title, refs_in_body(&body)))
        .collect();
    let mut items = Vec::new();
    for entry in fs::read_dir(dir)?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
            continue;
        };
        let meta = entry.metadata()?;
        let modified = meta.modified().map(DateTime::<Utc>::from).unwrap_or_else(|_| Utc::now());
        let used_by = notes
            .iter()
            .filter(|(_, _, refs)| refs.iter().any(|r| r == &name))
            .map(|(id, title, _)| MediaUsage { id: id.clone(), title: title.clone() })
            .collect();
        let ext = ext_of(&name);
        items.push(MediaItem {
            display_name: display_name(&name),
            kind: kind_of(&ext),
            ext,
            size: meta.len(),
            modified,
            used_by,
            name,
        });
    }
    items.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.name.cmp(&b.name)));
    Ok(items)
}

/// Raw text of an `.md` file under the notes dir or `.trash/`.
/// `live` is the note id when the file is a parseable, non-trashed note.
struct RawNote {
    path: PathBuf,
    raw: String,
    live: Option<String>,
}

fn raw_notes(store: &NotesStore) -> Vec<RawNote> {
    let mut out = Vec::new();
    for (dir, trash) in [(store.notes_dir(), false), (store.trash_dir(), true)] {
        let Ok(entries) = fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&path) else { continue };
            let live = if trash {
                None
            } else {
                let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
                store.read(stem).ok().map(|n| n.id)
            };
            out.push(RawNote { path, raw, live });
        }
    }
    out
}

/// Rename the display part of a stored file (uuid prefix kept) and rewrite
/// every `(attachments/<old>)` link in all notes, including trashed and
/// corrupt files (raw text, `updated` untouched). The original extension is
/// enforced: it is appended when `new_display` does not end with it.
/// All-or-nothing: on any write failure the file and notes are restored.
pub fn rename_media(dir: &Path, store: &mut NotesStore, name: &str, new_display: &str) -> Result<String> {
    validate_name(name)?;
    let new_display = new_display.trim();
    validate_name(new_display)?;
    let src = dir.join(name);
    if !src.is_file() {
        return Err(NoteError::NotFound(name.to_string()));
    }
    let ext = ext_of(name);
    let mut display = new_display.to_string();
    if !ext.is_empty() && ext_of(&display) != ext {
        display = format!("{display}.{ext}");
    }
    validate_name(&display)?;
    let new_name = match uuid_prefix(name) {
        Some(prefix) => format!("{prefix}-{display}"),
        None => format!("{}-{display}", uuid::Uuid::new_v4()),
    };
    if new_name == name {
        return Ok(new_name);
    }
    if !is_allowed(Path::new(&new_name)) {
        return Err(NoteError::Unknown(format!("Định dạng không hỗ trợ: {ext}")));
    }
    let dst = dir.join(&new_name);
    if dst.exists() {
        return Err(NoteError::Unknown(format!("File đã tồn tại: {display}")));
    }

    let old_link = format!("(attachments/{name})");
    let new_link = format!("(attachments/{new_name})");
    // Compute every new body up front so nothing is written if one fails to read.
    let mut plan: Vec<(RawNote, String)> = Vec::new();
    for n in raw_notes(store).into_iter().filter(|n| n.raw.contains(&old_link)) {
        let text = match &n.live {
            Some(id) => store.read(id)?.body.replace(&old_link, &new_link),
            None => n.raw.replace(&old_link, &new_link),
        };
        plan.push((n, text));
    }

    fs::rename(&src, &dst)?;
    for (i, (n, text)) in plan.iter().enumerate() {
        let res = match &n.live {
            Some(id) => store
                .update(id, NotePatch { body: Some(text.clone()), ..Default::default() })
                .map(|_| ()),
            None => write_atomic(&n.path, text.as_bytes()),
        };
        if let Err(e) = res {
            for (done, _) in &plan[..=i] {
                let _ = write_atomic(&done.path, done.raw.as_bytes());
                if let Some(id) = &done.live {
                    store.refresh(id);
                }
            }
            let _ = fs::rename(&dst, &src);
            return Err(e);
        }
    }
    Ok(new_name)
}

/// Remove whole `![..](attachments/name)` / `[..](attachments/name)` tokens,
/// leaving surrounding text. A bare `(attachments/name)` without a label is
/// removed too so the file is no longer referenced.
fn strip_links(body: &str, name: &str) -> String {
    let target = format!("(attachments/{name})");
    let mut out = String::with_capacity(body.len());
    let mut rest = body;
    while let Some(pos) = rest.find(&target) {
        let before = &rest[..pos];
        let mut cut = pos;
        if before.ends_with(']') {
            // Find the matching '[' on the same line (labels may nest brackets).
            let mut depth = 0i32;
            for (i, ch) in before.char_indices().rev() {
                match ch {
                    ']' => depth += 1,
                    '[' => {
                        depth -= 1;
                        if depth == 0 {
                            cut = i;
                            break;
                        }
                    }
                    '\n' => break,
                    _ => {}
                }
            }
            if cut != pos && before[..cut].ends_with('!') {
                cut -= 1;
            }
        }
        out.push_str(&rest[..cut]);
        rest = &rest[pos + target.len()..];
    }
    out.push_str(rest);
    out
}

/// Delete a stored file. Refuses when any note (trashed and corrupt files
/// included) references it, unless `force`: then the file is removed first
/// and links are stripped from live notes. Force still refuses when a
/// trashed/corrupt file references it, since those can't be edited safely.
pub fn delete_media(dir: &Path, store: &mut NotesStore, name: &str, force: bool) -> Result<()> {
    validate_name(name)?;
    let path = dir.join(name);
    if !path.is_file() {
        return Err(NoteError::NotFound(name.to_string()));
    }
    let users: Vec<RawNote> = raw_notes(store)
        .into_iter()
        .filter(|n| refs_in_body(&n.raw).iter().any(|r| r == name))
        .collect();
    if !users.is_empty() && !force {
        return Err(NoteError::Unknown(format!("File đang được dùng trong {} ghi chú", users.len())));
    }
    if users.iter().any(|n| n.live.is_none()) {
        return Err(NoteError::Unknown("Tệp đang được dùng bởi ghi chú trong thùng rác".into()));
    }
    fs::remove_file(&path)?;
    for n in users {
        let Some(id) = n.live else { continue };
        let body = strip_links(&store.read(&id)?.body, name);
        store.update(&id, NotePatch { body: Some(body), ..Default::default() })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const U: &str = "123e4567-e89b-12d3-a456-426614174000";

    fn setup() -> (TempDir, PathBuf, NotesStore) {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("att");
        fs::create_dir_all(&dir).unwrap();
        let store = NotesStore::new(tmp.path().join("notes")).unwrap();
        (tmp, dir, store)
    }

    #[test]
    fn kind_of_classifies() {
        assert_eq!(kind_of("PNG"), MediaKind::Image);
        assert_eq!(kind_of("webm"), MediaKind::Audio);
        assert_eq!(kind_of("m4a"), MediaKind::Audio);
        assert_eq!(kind_of("pdf"), MediaKind::Document);
        assert_eq!(kind_of("rs"), MediaKind::Other);
        assert_eq!(serde_json::to_string(&MediaKind::Audio).unwrap(), "\"audio\"");
    }

    #[test]
    fn display_name_strips_uuid_prefix() {
        assert_eq!(display_name(&format!("{U}-a b.png")), "a b.png");
        assert_eq!(display_name("plain.png"), "plain.png");
        assert_eq!(display_name("not-a-uuid-at-all-xxxxxxxxxxxxxxxxxx-x.png"), "not-a-uuid-at-all-xxxxxxxxxxxxxxxxxx-x.png");
    }

    #[test]
    fn list_media_reports_usage_newest_first() {
        let (_t, dir, mut store) = setup();
        let a = format!("{U}-a.png");
        fs::write(dir.join(&a), "aa").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(dir.join("b.mp3"), "b").unwrap();
        let n = store.create("Note A", &format!("x ![i](attachments/{a})"), vec![]).unwrap();

        let items = list_media(&dir, &store).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].name, "b.mp3");
        assert_eq!(items[0].kind, MediaKind::Audio);
        assert!(items[0].used_by.is_empty());
        assert_eq!(items[1].display_name, "a.png");
        assert_eq!(items[1].size, 2);
        assert_eq!(items[1].used_by, vec![MediaUsage { id: n.id, title: "Note A".into() }]);
        let json = serde_json::to_value(&items[1]).unwrap();
        assert!(json.get("displayName").is_some() && json.get("usedBy").is_some());
    }

    #[test]
    fn rename_media_keeps_prefix_and_rewrites_links() {
        let (_t, dir, mut store) = setup();
        let old = format!("{U}-old.png");
        fs::write(dir.join(&old), "x").unwrap();
        let n = store.create("N", &format!("a ![p](attachments/{old}) b [q](attachments/{old})"), vec![]).unwrap();

        let new = rename_media(&dir, &mut store, &old, "new name").unwrap();
        assert_eq!(new, format!("{U}-new name.png"));
        assert!(dir.join(&new).exists() && !dir.join(&old).exists());
        let body = store.read(&n.id).unwrap().body;
        assert_eq!(body, format!("a ![p](attachments/{new}) b [q](attachments/{new})"));

        assert_eq!(rename_media(&dir, &mut store, &new, "Z.PNG").unwrap(), format!("{U}-Z.PNG"));
        assert!(rename_media(&dir, &mut store, &format!("{U}-Z.PNG"), "a/b").is_err());
        assert!(rename_media(&dir, &mut store, "missing.png", "x").is_err());
    }

    #[test]
    fn rename_media_rejects_collision() {
        let (_t, dir, mut store) = setup();
        fs::write(dir.join(format!("{U}-a.png")), "1").unwrap();
        fs::write(dir.join(format!("{U}-b.png")), "2").unwrap();
        assert!(rename_media(&dir, &mut store, &format!("{U}-a.png"), "b").is_err());
    }

    #[test]
    fn delete_media_requires_force_when_used() {
        let (_t, dir, mut store) = setup();
        let f = format!("{U}-img (1).png");
        fs::write(dir.join(&f), "x").unwrap();
        let n = store
            .create("N", &format!("before ![alt [x]](attachments/{f}) mid [doc](attachments/{f}) after"), vec![])
            .unwrap();

        assert!(delete_media(&dir, &mut store, &f, false).is_err());
        assert!(dir.join(&f).exists());
        delete_media(&dir, &mut store, &f, true).unwrap();
        assert!(!dir.join(&f).exists());
        assert_eq!(store.read(&n.id).unwrap().body, "before  mid  after");

        fs::write(dir.join("free.pdf"), "x").unwrap();
        delete_media(&dir, &mut store, "free.pdf", false).unwrap();
        assert!(delete_media(&dir, &mut store, "../x", true).is_err());
    }

    #[test]
    fn delete_media_refuses_trashed_or_corrupt_refs() {
        let (_t, dir, mut store) = setup();
        let f = format!("{U}-t.png");
        fs::write(dir.join(&f), "x").unwrap();
        let n = store.create("T", &format!("![a](attachments/{f})"), vec![]).unwrap();
        store.delete(&n.id).unwrap();
        assert!(delete_media(&dir, &mut store, &f, false).is_err());
        let e = delete_media(&dir, &mut store, &f, true).unwrap_err().to_string();
        assert!(e.contains("thùng rác"));
        assert!(dir.join(&f).exists());

        let g = format!("{U}-c.png");
        fs::write(dir.join(&g), "x").unwrap();
        fs::write(store.notes_dir().join("broken.md"), format!("---\nnot: [valid\n---\n![b](attachments/{g})")).unwrap();
        store.reload();
        assert!(delete_media(&dir, &mut store, &g, false).is_err());
        assert!(delete_media(&dir, &mut store, &g, true).is_err());
        assert!(dir.join(&g).exists());
    }

    #[test]
    fn rename_media_rewrites_trashed_and_corrupt_files() {
        let (_t, dir, mut store) = setup();
        let old = format!("{U}-o.png");
        fs::write(dir.join(&old), "x").unwrap();
        let n = store.create("T", &format!("![a](attachments/{old})"), vec![]).unwrap();
        store.delete(&n.id).unwrap();
        let trashed = store.trash_dir().join(format!("{}.md", n.id));
        let before = fs::read_to_string(&trashed).unwrap();
        let corrupt = store.notes_dir().join("broken.md");
        fs::write(&corrupt, format!("---\nnot: [valid\n---\n[b](attachments/{old})")).unwrap();
        store.reload();

        let new = rename_media(&dir, &mut store, &old, "n").unwrap();
        // Exact raw replace: `updated` in the trashed frontmatter is untouched.
        assert_eq!(fs::read_to_string(&trashed).unwrap(), before.replace(&old, &new));
        assert!(fs::read_to_string(&corrupt).unwrap().contains(&format!("(attachments/{new})")));
    }

    #[test]
    fn rename_media_rejects_unsafe_names() {
        let (_t, dir, mut store) = setup();
        let f = format!("{U}-a.png");
        fs::write(dir.join(&f), "x").unwrap();
        for bad in ["a:b", "con", "LPT1.png", "x\u{1}y"] {
            assert!(rename_media(&dir, &mut store, &f, bad).is_err(), "{bad:?}");
        }
        assert!(dir.join(&f).exists());
    }
}
