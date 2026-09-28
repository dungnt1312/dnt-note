use crate::error::{NoteError, Result};
use crate::note::Note;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// The fixed 6-field frontmatter schema. Anything else in the YAML block is
/// dropped on re-serialize (by design — see round-trip test).
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Frontmatter {
    id: String,
    title: String,
    tags: Vec<String>,
    pinned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    folder: Option<String>,
    created: Option<DateTime<Utc>>,
    updated: Option<DateTime<Utc>>,
}

/// Parse a full note file (frontmatter + markdown body).
pub fn parse(contents: &str) -> Result<Note> {
    let normalized = contents.replace("\r\n", "\n");
    let (yaml_block, body) = split_frontmatter(&normalized)?;
    let fm: Frontmatter = serde_yaml::from_str(&yaml_block)
        .map_err(|e| NoteError::Yaml(e.to_string()))?;
    if fm.id.trim().is_empty() {
        return Err(NoteError::MissingId);
    }
    let now = Utc::now();
    Ok(Note {
        id: fm.id,
        title: if fm.title.trim().is_empty() {
            "Untitled".to_string()
        } else {
            fm.title
        },
        tags: fm.tags,
        pinned: fm.pinned,
        folder: fm.folder,
        created: fm.created.unwrap_or(now),
        updated: fm.updated.unwrap_or(now),
        body: body.to_string(),
    })
}

/// Serialize a note back to file contents (`---\n{yaml}---\n{body}`).
pub fn serialize(note: &Note) -> String {
    let fm = Frontmatter {
        id: note.id.clone(),
        title: note.title.clone(),
        tags: note.tags.clone(),
        pinned: note.pinned,
        folder: note.folder.clone(),
        created: Some(note.created),
        updated: Some(note.updated),
    };
    let yaml = serde_yaml::to_string(&fm).unwrap_or_default();
    format!("---\n{yaml}---\n{}", note.body)
}

/// Split leading `---\n...\n---\n` frontmatter; returns (yaml, body).
/// Body may itself contain `---` lines — only the first closing fence counts.
fn split_frontmatter(contents: &str) -> Result<(String, &str)> {
    let mut lines = contents.split_inclusive('\n');
    let first = lines.next().unwrap_or("");
    if first.trim_end() != "---" {
        return Err(NoteError::Yaml("missing opening ---".into()));
    }
    let mut yaml = String::new();
    let mut rest_start = first.len();
    for line in lines {
        rest_start += line.len();
        if line.trim_end() == "---" || line.trim_end() == "..." {
            return Ok((yaml, &contents[rest_start..]));
        }
        yaml.push_str(line);
    }
    Err(NoteError::Yaml("missing closing ---".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_note() -> Note {
        Note {
            id: "a1".into(),
            title: "Ghi chú: tiếng Việt".into(),
            tags: vec!["work".into(), "a:b".into()],
            pinned: true,
            folder: None,
            created: DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z").unwrap().into(),
            updated: DateTime::parse_from_rfc3339("2026-01-02T00:00:00Z").unwrap().into(),
            body: "line1\n\n---\n\nline2".into(),
        }
    }

    #[test]
    fn round_trip_preserves_all_fields() {
        let note = sample_note();
        let parsed = parse(&serialize(&note)).unwrap();
        assert_eq!(parsed, note);
    }

    #[test]
    fn parses_minimal_frontmatter() {
        let parsed = parse("---\nid: x\n---\nbody here").unwrap();
        assert_eq!(parsed.id, "x");
        assert_eq!(parsed.title, "Untitled");
        assert!(parsed.tags.is_empty());
        assert!(!parsed.pinned);
        assert_eq!(parsed.body, "body here");
    }

    #[test]
    fn rejects_missing_id() {
        assert!(matches!(parse("---\ntitle: no id\n---\n"), Err(NoteError::MissingId)));
    }

    #[test]
    fn body_with_dashes_survives() {
        let note = sample_note();
        let parsed = parse(&serialize(&note)).unwrap();
        assert_eq!(parsed.body, "line1\n\n---\n\nline2");
    }

    #[test]
    fn crlf_input_normalized() {
        let raw = "---\r\nid: c\r\ntitle: T\r\n---\r\nbody\r\nmore";
        let parsed = parse(raw).unwrap();
        assert_eq!(parsed.body, "body\nmore");
    }

    #[test]
    fn unicode_title_tag_round_trip() {
        let mut note = sample_note();
        note.title = "Tiêu đề 🎉 tiếng Việt".into();
        note.tags = vec!["nhân văn".into(), "học tập 2026".into()];
        let parsed = parse(&serialize(&note)).unwrap();
        assert_eq!(parsed.title, note.title);
        assert_eq!(parsed.tags, note.tags);
    }

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

    #[test]
    fn serialize_omits_unknown_frontmatter() {
        let raw = "---\nid: u\nlegacy_field: 1\n---\nbody";
        let note = parse(raw).unwrap();
        let out = serialize(&note);
        assert!(!out.contains("legacy_field"));
        assert!(out.contains("id: u"));
    }
}
