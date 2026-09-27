use crate::state::AppState;
use notes_core::attachments;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{Manager, State};

type CmdResult<T> = Result<T, String>;

pub(crate) fn err_of(e: impl std::fmt::Display) -> String {
    format!("attachment-error: {e}")
}

pub(crate) fn attachments_dir(app: &tauri::AppHandle) -> CmdResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("data dir: {e}"))?
        .join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir attachments: {e}"))?;
    Ok(dir)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredFile {
    pub name: String,
    pub size: u64,
}

/// Copy `src_path` into attachments/ and append a markdown reference to the note body.
#[tauri::command]
pub fn attach_file(
    app: tauri::AppHandle,
    state: State<AppState>,
    note_id: String,
    src_path: String,
) -> CmdResult<StoredFile> {
    let src = PathBuf::from(&src_path);
    // Limit: ≤10 refs per note
    {
        let store = state.store.lock().map_err(err_of)?;
        let note = store.read(&note_id).map_err(err_of)?;
        if notes_core::attachments::unique_ref_count(&note.body) >= attachments::MAX_FILES_PER_NOTE {
            return Err("attachment-error: Tối đa 10 file đính kèm mỗi ghi chú".into());
        }
    }
    let dir = attachments_dir(&app)?;
    let stored_name = attachments::save_file(&dir, &src).map_err(err_of)?;
    let size = std::fs::metadata(dir.join(&stored_name)).map(|m| m.len()).unwrap_or(0);

    // Append markdown link to the note body (image vs file syntax).
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let is_image = ["png", "jpg", "jpeg", "gif", "webp", "bmp"].contains(&ext.as_str());
    let link = if is_image {
        format!("\n![{}](", &stored_name)
    } else {
        format!("\n[{}](", &stored_name)
    };
    let mut store = state.store.lock().map_err(err_of)?;
    let mut note = store.read(&note_id).map_err(err_of)?;
    if !note.body.ends_with('\n') && !note.body.is_empty() {
        note.body.push('\n');
    }
    note.body.push_str(&link);
    note.body.push_str("attachments/");
    note.body.push_str(&stored_name);
    note.body.push(')');
    store
        .update(&note_id, notes_core::note::NotePatch {
            body: Some(note.body),
            ..Default::default()
        })
        .map_err(err_of)?;

    Ok(StoredFile { name: stored_name, size })
}

#[tauri::command]
pub fn list_attachments(state: State<AppState>, note_id: String) -> CmdResult<Vec<String>> {
    let store = state.store.lock().map_err(err_of)?;
    let note = store.read(&note_id).map_err(err_of)?;
    Ok(notes_core::attachments::refs_in_body(&note.body))
}

#[tauri::command]
pub fn extract_attachment_text(path: String) -> CmdResult<String> {
    let p = PathBuf::from(&path);
    if p.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
    {
        return pdf_extract::extract_text(&p)
            .map(|t| t.chars().take(400_000).collect())
            .map_err(|e| format!("attachment-error: PDF: {e}"));
    }
    notes_core::attachments::extract_text(&p).map_err(err_of)
}

#[tauri::command]
pub fn prepare_attachment_image(path: String) -> CmdResult<String> {
    notes_core::attachments::prepare_image(&PathBuf::from(&path), attachments::MAX_IMAGE_EDGE_PX)
        .map_err(err_of)
}

#[tauri::command]
pub fn cleanup_orphan_attachments(
    app: tauri::AppHandle,
    state: State<AppState>,
) -> CmdResult<usize> {
    let dir = attachments_dir(&app)?;
    let refs = state.store.lock().map_err(err_of)?.attachment_refs();
    notes_core::attachments::cleanup_orphans(&dir, &refs, attachments::ORPHAN_GRACE).map_err(err_of)
}
