use super::attachments::{attachments_dir, err_of, StoredFile};
use crate::state::AppState;
use base64::Engine as _;
use notes_core::{attachments, media};
use std::path::PathBuf;
use tauri::State;

type CmdResult<T> = Result<T, String>;

#[tauri::command]
pub fn list_media(app: tauri::AppHandle, state: State<AppState>) -> CmdResult<Vec<media::MediaItem>> {
    let dir = attachments_dir(&app)?;
    let store = state.store.lock().map_err(err_of)?;
    media::list_media(&dir, &store).map_err(err_of)
}

#[tauri::command]
pub fn rename_media(
    app: tauri::AppHandle,
    state: State<AppState>,
    name: String,
    new_name: String,
) -> CmdResult<String> {
    let dir = attachments_dir(&app)?;
    let mut store = state.store.lock().map_err(err_of)?;
    media::rename_media(&dir, &mut store, &name, &new_name).map_err(err_of)
}

#[tauri::command]
pub fn delete_media(app: tauri::AppHandle, state: State<AppState>, name: String, force: bool) -> CmdResult<()> {
    let dir = attachments_dir(&app)?;
    let mut store = state.store.lock().map_err(err_of)?;
    media::delete_media(&dir, &mut store, &name, force).map_err(err_of)
}

/// Copy a file into the library without linking it to any note.
#[tauri::command]
pub fn import_media(app: tauri::AppHandle, src_path: String) -> CmdResult<StoredFile> {
    let dir = attachments_dir(&app)?;
    let name = attachments::save_file(&dir, &PathBuf::from(&src_path)).map_err(err_of)?;
    let size = std::fs::metadata(dir.join(&name)).map(|m| m.len()).unwrap_or(0);
    Ok(StoredFile { name, size })
}

/// Store pasted/recorded bytes; the frontend inserts the link at the cursor.
#[tauri::command]
pub fn attach_bytes(
    app: tauri::AppHandle,
    state: State<AppState>,
    note_id: String,
    file_name: String,
    base64: String,
) -> CmdResult<StoredFile> {
    {
        let store = state.store.lock().map_err(err_of)?;
        let note = store.read(&note_id).map_err(err_of)?;
        if attachments::unique_ref_count(&note.body) >= attachments::MAX_FILES_PER_NOTE {
            return Err("attachment-error: Tối đa 10 file đính kèm mỗi ghi chú".into());
        }
    }
    // Reject oversized payloads before decoding (base64 is ~4/3 of raw size).
    if (base64.len() as u64) / 4 * 3 > attachments::MAX_FILE_BYTES + 3 {
        return Err("attachment-error: File quá lớn (giới hạn 25MB)".into());
    }
    let payload = base64.split_once(',').map(|(_, b)| b).unwrap_or(&base64);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|e| format!("attachment-error: base64: {e}"))?;
    let dir = attachments_dir(&app)?;
    let name = attachments::save_bytes(&dir, &file_name, &bytes).map_err(err_of)?;
    Ok(StoredFile { name, size: bytes.len() as u64 })
}

#[tauri::command]
pub fn attachments_dir_path(app: tauri::AppHandle) -> CmdResult<String> {
    Ok(attachments_dir(&app)?.to_string_lossy().into_owned())
}

/// Store raw bytes in the library without linking them to a note (chat uploads).
#[tauri::command]
pub fn import_media_bytes(app: tauri::AppHandle, file_name: String, base64: String) -> CmdResult<StoredFile> {
    if (base64.len() as u64) / 4 * 3 > attachments::MAX_FILE_BYTES + 3 {
        return Err("attachment-error: File quá lớn (giới hạn 25MB)".into());
    }
    let payload = base64.split_once(',').map(|(_, b)| b).unwrap_or(&base64);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|e| format!("attachment-error: base64: {e}"))?;
    let dir = attachments_dir(&app)?;
    let name = attachments::save_bytes(&dir, &file_name, &bytes).map_err(err_of)?;
    Ok(StoredFile { name, size: bytes.len() as u64 })
}
