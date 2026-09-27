use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Full note — mirrors `<id>.md` on disk (frontmatter + body).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub created: DateTime<Utc>,
    pub updated: DateTime<Utc>,
    pub body: String,
}

/// List-view projection without the full body.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub id: String,
    pub title: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub created: DateTime<Utc>,
    pub updated: DateTime<Utc>,
    pub snippet: String,
    pub word_count: u32,
}

impl From<&Note> for NoteMeta {
    fn from(note: &Note) -> Self {
        NoteMeta {
            id: note.id.clone(),
            title: note.title.clone(),
            tags: note.tags.clone(),
            pinned: note.pinned,
            created: note.created,
            updated: note.updated,
            snippet: snippet_of(&note.body),
            word_count: word_count(&note.body),
        }
    }
}

/// Partial update — `None` fields are left untouched.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub tags: Option<Vec<String>>,
    pub pinned: Option<bool>,
    /// Edit origin ("agent" / "mcp" force a history snapshot).
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total: usize,
    pub pinned: usize,
    pub words: u64,
    pub tags: usize,
}

/// First ~140 chars of body, markdown markers stripped, whitespace collapsed.
pub fn snippet_of(body: &str) -> String {
    let stripped: String = body
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect::<Vec<_>>()
        .join(" ");
    let collapsed = collapsed_spaces(&stripped);
    if collapsed.chars().count() <= 140 {
        collapsed
    } else {
        collapsed.chars().take(140).collect::<String>() + "…"
    }
}

pub fn word_count(body: &str) -> u32 {
    body.split_whitespace().count() as u32
}

fn collapsed_spaces(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_space = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
            }
            prev_space = true;
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    out.trim().to_string()
}
