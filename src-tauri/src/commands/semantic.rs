use notes_core::store::write_atomic;
use std::path::{Path, PathBuf};
use tauri::Manager;

fn embeddings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Lỗi đường dẫn dữ liệu: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("embeddings.json"))
}

pub fn load_from(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save_to(path: &Path, json: &str) -> Result<(), String> {
    write_atomic(path, json.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_embeddings(app: tauri::AppHandle) -> Result<String, String> {
    load_from(&embeddings_path(&app)?)
}

#[tauri::command]
pub fn save_embeddings(app: tauri::AppHandle, json: String) -> Result<(), String> {
    save_to(&embeddings_path(&app)?, &json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_is_empty_then_roundtrips() {
        let dir = std::env::temp_dir().join(format!("dnt-emb-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("embeddings.json");
        let _ = std::fs::remove_file(&p);
        assert_eq!(load_from(&p).unwrap(), "");
        save_to(&p, "{\"model\":\"m\"}").unwrap();
        assert_eq!(load_from(&p).unwrap(), "{\"model\":\"m\"}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
