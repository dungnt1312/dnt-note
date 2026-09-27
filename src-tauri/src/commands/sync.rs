use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;

#[tauri::command]
pub fn get_sync_folder(app: AppHandle) -> Result<Option<String>, String> {
    let settings = app.store("settings.json").map_err(|e| format!("settings: {e}"))?;
    Ok(settings
        .get("syncFolder")
        .and_then(|v| v.as_str().map(|s| s.to_string())))
}

#[tauri::command]
pub fn set_sync_folder(app: AppHandle, path: Option<String>) -> Result<(), String> {
    let settings = app.store("settings.json").map_err(|e| format!("settings: {e}"))?;
    match path.as_deref() {
        Some(p) if !p.trim().is_empty() => settings.set("syncFolder", p.trim()),
        _ => settings.set("syncFolder", serde_json::Value::Null),
    }
    settings.save().map_err(|e| format!("save settings: {e}"))?;

    // Mirror immediately in a worker thread; the watcher handles future changes.
    let handle = app.clone();
    std::thread::spawn(move || {
        let Some(target) = crate::get_sync_dir(&handle) else { return };
        let notes_dir = handle.path().app_data_dir().expect("data dir").join("notes");
        match notes_core::sync::mirror(&notes_dir, &target) {
            Ok(report) => {
                if let Some(state) = handle.try_state::<crate::AppState>() {
                    let _guard = state.sync_lock.lock();
                    if let Ok(mut store) = state.store.lock() {
                        store.reload();
                    }
                }
                let _ = handle.emit(
                    "sync://status",
                    serde_json::json!({
                        "copiedOut": report.copied_out,
                        "copiedIn": report.copied_in,
                        "resolved": report.resolved,
                    }),
                );
            }
            Err(e) => eprintln!("sync failed: {e}"),
        }
    });
    Ok(())
}
