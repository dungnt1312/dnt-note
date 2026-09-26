mod commands;
mod state;

use notes_core::store::NotesStore;
use notes_core::watcher::NotesWatcher;
use state::AppState;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;

fn app_data_notes_dir(app: &AppHandle) -> std::path::PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("no app data dir")
        .join("notes");
    std::fs::create_dir_all(&dir).expect("cannot create notes dir");
    dir
}

fn is_onboarded(app: &AppHandle) -> bool {
    app.store("settings.json")
        .ok()
        .and_then(|s| s.get("onboarded"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn mark_onboarded(app: &AppHandle) {
    if let Ok(store) = app.store("settings.json") {
        store.set("onboarded", true);
        let _ = store.save();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            let notes_dir = app_data_notes_dir(&handle);
            let mut notes_store = NotesStore::new(notes_dir.clone())
                .map_err(|e| format!("init store: {e}"))?;

            if !is_onboarded(&handle) {
                commands::notes::seed_demo_notes(&mut notes_store)
                    .map_err(|e| format!("seed demo: {e}"))?;
                mark_onboarded(&handle);
            }

            // Watcher → reload store → notify frontend which notes changed.
            std::thread::spawn(move || {
                let handle = handle.clone();
                let result = NotesWatcher::start(&notes_dir, 300, move |ids| {
                    if let Ok(mut store) = handle.state::<AppState>().store.lock() {
                        store.reload();
                    }
                    let _ = handle.emit("notes://changed", &ids);
                });
                if let Err(e) = result {
                    eprintln!("watcher failed: {e}");
                }
            });

            app.manage(AppState {
                store: std::sync::Mutex::new(notes_store),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::notes::list_notes,
            commands::notes::read_note,
            commands::notes::create_note,
            commands::notes::update_note,
            commands::notes::delete_note,
            commands::notes::restore_note,
            commands::notes::search_notes,
            commands::notes::list_tags,
            commands::notes::empty_trash,
            commands::stats::get_stats,
            commands::chats::list_chats,
            commands::chats::load_chat,
            commands::chats::save_chat,
            commands::chats::delete_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
