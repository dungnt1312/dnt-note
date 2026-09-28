use crate::error::{NoteError, Result};
use crate::note::{word_count, Note};
use crate::note_file;
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

pub const MAX_VERSIONS: usize = 50;
pub const THROTTLE_SECS: i64 = 5 * 60;
/// Minimum gap between forced snapshots from agent/MCP edits.
pub const AGENT_THROTTLE_SECS: i64 = 10;
const VERSION_FMT: &str = "%Y%m%dT%H%M%S%3fZ";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VersionMeta {
    pub version: String,
    pub created: DateTime<Utc>,
    pub title: String,
    pub words: u32,
}

pub fn history_root(notes_dir: &Path) -> PathBuf {
    notes_dir.join(".history")
}

/// A note id safe to join onto the notes dir: no separators, traversal or
/// drive-letter colons (ids are uuids in practice; this guards raw IPC input).
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id != "."
        && !id.contains("..")
        && !id.contains(['/', '\\', ':'])
}

pub fn valid_version(v: &str) -> bool {
    let b = v.as_bytes();
    b.len() == 19
        && b[8] == b'T'
        && b[18] == b'Z'
        && b[..8].iter().all(u8::is_ascii_digit)
        && b[9..18].iter().all(u8::is_ascii_digit)
}

fn note_dir(notes_dir: &Path, id: &str) -> Result<PathBuf> {
    if !valid_id(id) {
        return Err(NoteError::Unknown("ID ghi chú không hợp lệ".into()));
    }
    Ok(history_root(notes_dir).join(id))
}

pub fn version_id(t: DateTime<Utc>) -> String {
    t.format(VERSION_FMT).to_string()
}

fn parse_version(v: &str) -> Option<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(v, VERSION_FMT)
        .ok()
        .map(|n| n.and_utc())
}

/// Sorted version ids, newest first.
fn version_ids(dir: &Path) -> Vec<String> {
    let mut ids: Vec<String> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_str()?.to_string();
                    let stem = name.strip_suffix(".md")?;
                    valid_version(stem).then(|| stem.to_string())
                })
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    ids.reverse();
    ids
}

/// Save `old` as a version. Skipped (Ok(None)) when the newest snapshot is
/// younger than the throttle window, unless `force`.
pub fn snapshot(notes_dir: &Path, old: &Note, now: DateTime<Utc>, force: bool) -> Result<Option<String>> {
    snapshot_with_gap(notes_dir, old, now, if force { 0 } else { THROTTLE_SECS })
}

/// Save `old` unless the newest snapshot is younger than `min_gap_secs`.
pub fn snapshot_with_gap(notes_dir: &Path, old: &Note, now: DateTime<Utc>, min_gap_secs: i64) -> Result<Option<String>> {
    let dir = note_dir(notes_dir, &old.id)?;
    let existing = version_ids(&dir);
    if min_gap_secs > 0 {
        if let Some(latest) = existing.first().and_then(|v| parse_version(v)) {
            if (now - latest).num_milliseconds() < min_gap_secs * 1000 {
                return Ok(None);
            }
        }
    }
    fs::create_dir_all(&dir)?;
    let mut t = now;
    let mut version = version_id(t);
    // Avoid clobbering an existing snapshot at the same millisecond.
    while dir.join(format!("{version}.md")).exists() {
        t += chrono::Duration::milliseconds(1);
        version = version_id(t);
    }
    fs::write(dir.join(format!("{version}.md")), note_file::serialize(old))?;
    for stale in version_ids(&dir).into_iter().skip(MAX_VERSIONS) {
        let _ = fs::remove_file(dir.join(format!("{stale}.md")));
    }
    Ok(Some(version))
}

pub fn list_versions(notes_dir: &Path, id: &str) -> Result<Vec<VersionMeta>> {
    let dir = note_dir(notes_dir, id)?;
    let mut out = Vec::new();
    for v in version_ids(&dir) {
        let Some(created) = parse_version(&v) else { continue };
        let Ok(note) = read_version(notes_dir, id, &v) else { continue };
        out.push(VersionMeta {
            version: v,
            created,
            title: note.title,
            words: word_count(&note.body),
        });
    }
    Ok(out)
}

pub fn read_version(notes_dir: &Path, id: &str, version: &str) -> Result<Note> {
    let dir = note_dir(notes_dir, id)?;
    if !valid_version(version) {
        return Err(NoteError::Unknown("Mã phiên bản không hợp lệ".into()));
    }
    let path = dir.join(format!("{version}.md"));
    if !path.exists() {
        return Err(NoteError::Unknown("Không tìm thấy phiên bản".into()));
    }
    note_file::parse(&fs::read_to_string(path)?)
}

/// Newest snapshot of a note, if any.
pub fn latest(notes_dir: &Path, id: &str) -> Result<Option<Note>> {
    let dir = note_dir(notes_dir, id)?;
    match version_ids(&dir).first() {
        Some(v) => read_version(notes_dir, id, v).map(Some),
        None => Ok(None),
    }
}

pub fn remove_history(notes_dir: &Path, id: &str) {
    if let Ok(dir) = note_dir(notes_dir, id) {
        let _ = fs::remove_dir_all(dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use tempfile::TempDir;

    fn note(body: &str) -> Note {
        let t = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        Note { id: "n1".into(), title: "T".into(), tags: vec![], pinned: false, folder: None, created: t, updated: t, body: body.into() }
    }

    fn at(min: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 27, 14, 30, 5).unwrap() + chrono::Duration::milliseconds(123) + chrono::Duration::minutes(min)
    }

    #[test]
    fn version_id_format() {
        assert_eq!(version_id(at(0)), "20260927T143005123Z");
        assert!(valid_version("20260927T143005123Z"));
        assert!(!valid_version("20260927T14300512Z"));
        assert!(!valid_version("../../etc/passwdxx"));
    }

    #[test]
    fn throttle_and_force() {
        let tmp = TempDir::new().unwrap();
        let d = tmp.path();
        assert!(snapshot(d, &note("a"), at(0), false).unwrap().is_some());
        assert!(snapshot(d, &note("b"), at(4), false).unwrap().is_none());
        assert!(snapshot(d, &note("c"), at(4), true).unwrap().is_some());
        assert!(snapshot(d, &note("d"), at(9), false).unwrap().is_some());
        let list = list_versions(d, "n1").unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].version, version_id(at(9)));
        assert_eq!(read_version(d, "n1", &list[0].version).unwrap().body, "d");
    }

    #[test]
    fn prunes_to_fifty() {
        let tmp = TempDir::new().unwrap();
        for i in 0..55 {
            snapshot(tmp.path(), &note(&format!("v{i}")), at(i), true).unwrap();
        }
        let list = list_versions(tmp.path(), "n1").unwrap();
        assert_eq!(list.len(), 50);
        assert_eq!(read_version(tmp.path(), "n1", &list[49].version).unwrap().body, "v5");
    }

    #[test]
    fn validates_inputs() {
        let tmp = TempDir::new().unwrap();
        assert!(read_version(tmp.path(), "../x", "20260927T143005123Z").is_err());
        assert!(read_version(tmp.path(), "n1", "..").is_err());
        assert!(list_versions(tmp.path(), "a/b").is_err());
        assert!(list_versions(tmp.path(), "none").unwrap().is_empty());
    }
}
