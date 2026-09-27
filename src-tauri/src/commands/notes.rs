use crate::state::AppState;
use notes_core::history::{self, VersionMeta};
use notes_core::note::{Note, NoteMeta, NotePatch};
use notes_core::store::NotesStore;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn err_of(e: impl std::fmt::Display) -> String {
    format!("note-error: {e}")
}

#[tauri::command]
pub fn list_notes(state: State<AppState>) -> CmdResult<Vec<NoteMeta>> {
    let store = state.store.lock().map_err(err_of)?;
    Ok(store.list())
}

#[tauri::command]
pub fn read_note(state: State<AppState>, id: String) -> CmdResult<Note> {
    let store = state.store.lock().map_err(err_of)?;
    store.read(&id).map_err(err_of)
}

#[tauri::command]
pub fn create_note(
    state: State<AppState>,
    title: String,
    body: Option<String>,
    tags: Option<Vec<String>>,
) -> CmdResult<Note> {
    let mut store = state.store.lock().map_err(err_of)?;
    store
        .create(&title, body.as_deref().unwrap_or(""), tags.unwrap_or_default())
        .map_err(err_of)
}

#[tauri::command]
pub fn update_note(
    state: State<AppState>,
    id: String,
    patch: NotePatch,
) -> CmdResult<Note> {
    let mut store = state.store.lock().map_err(err_of)?;
    store.update(&id, patch).map_err(err_of)
}

#[tauri::command]
pub fn list_versions(state: State<AppState>, id: String) -> CmdResult<Vec<VersionMeta>> {
    let store = state.store.lock().map_err(err_of)?;
    history::list_versions(store.notes_dir(), &id).map_err(err_of)
}

#[tauri::command]
pub fn read_version(state: State<AppState>, id: String, version: String) -> CmdResult<Note> {
    let store = state.store.lock().map_err(err_of)?;
    history::read_version(store.notes_dir(), &id, &version).map_err(err_of)
}

#[tauri::command]
pub fn restore_version(state: State<AppState>, id: String, version: String) -> CmdResult<Note> {
    let mut store = state.store.lock().map_err(err_of)?;
    store.restore_version(&id, &version).map_err(err_of)
}

#[tauri::command]
pub fn snapshot_note(state: State<AppState>, id: String) -> CmdResult<Option<String>> {
    let store = state.store.lock().map_err(err_of)?;
    store.snapshot_current(&id).map_err(err_of)
}

#[tauri::command]
pub fn delete_note(state: State<AppState>, id: String) -> CmdResult<()> {
    let mut store = state.store.lock().map_err(err_of)?;
    store.delete(&id).map_err(err_of)
}

#[tauri::command]
pub fn restore_note(state: State<AppState>, id: String) -> CmdResult<Note> {
    let mut store = state.store.lock().map_err(err_of)?;
    store.restore(&id).map_err(err_of)
}

#[tauri::command]
pub fn search_notes(
    state: State<AppState>,
    query: String,
    limit: Option<usize>,
) -> CmdResult<Vec<NoteMeta>> {
    let store = state.store.lock().map_err(err_of)?;
    Ok(store.search(&query, limit.unwrap_or(20)))
}

#[tauri::command]
pub fn get_backlinks(state: State<AppState>, id: String) -> CmdResult<Vec<NoteMeta>> {
    let store = state.store.lock().map_err(err_of)?;
    store.backlinks(&id).map_err(err_of)
}

#[tauri::command]
pub fn list_tags(state: State<AppState>) -> CmdResult<Vec<TagCount>> {
    let store = state.store.lock().map_err(err_of)?;
    Ok(store
        .tags()
        .into_iter()
        .map(|(name, count)| TagCount { name, count })
        .collect())
}

#[tauri::command]
pub fn empty_trash(state: State<AppState>) -> CmdResult<usize> {
    let store = state.store.lock().map_err(err_of)?;
    Ok(store.empty_trash())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub name: String,
    pub count: usize,
}

/// Public for tests; used by lib.rs setup to seed demo notes.
pub fn seed_demo_notes(store: &mut NotesStore) -> std::io::Result<()> {
    const WELCOME: &str = include_str!("../../resources/demo/01-welcome.md");
    const MARKDOWN: &str = include_str!("../../resources/demo/02-markdown.md");
    const CHECKLIST: &str = include_str!("../../resources/demo/03-checklist.md");
    const AI: &str = include_str!("../../resources/demo/04-ai-assistant.md");
    let demos: [(&str, &[&str], &str); 4] = [
        ("Chào mừng đến DNT Note", &["hướng dẫn"], WELCOME),
        ("Markdown cheat sheet", &["hướng dẫn", "markdown"], MARKDOWN),
        ("Danh sách việc cần làm", &["demo"], CHECKLIST),
        ("AI Assistant (sắp có)", &["ai"], AI),
    ];
    for (title, tags, body) in demos {
        store
            .create(title, body, tags.iter().map(|t| t.to_string()).collect())
            .map_err(|e| std::io::Error::other(e.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn seeds_exactly_four_demo_notes() {
        let tmp = TempDir::new().unwrap();
        let mut store = NotesStore::new(tmp.path().join("notes")).unwrap();
        seed_demo_notes(&mut store).unwrap();
        let list = store.list();
        assert_eq!(list.len(), 4);
        assert!(list.iter().any(|n| n.title.contains("Chào mừng")));
        assert!(list.iter().any(|n| n.tags.contains(&"markdown".to_string())));
        // Idempotent at the call site via the `onboarded` flag; seed itself appends.
        seed_demo_notes(&mut store).unwrap();
        assert_eq!(store.list().len(), 8);
    }
}
