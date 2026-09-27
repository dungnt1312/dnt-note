mod commands;
mod state;

use notes_core::store::NotesStore;
use notes_core::sync;
use notes_core::watcher::NotesWatcher;
use state::AppState;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_store::StoreExt;

fn app_data_dir(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .expect("no app data dir")
}

fn app_data_notes_dir(app: &AppHandle) -> std::path::PathBuf {
    let dir = app_data_dir(app).join("notes");
    std::fs::create_dir_all(&dir).expect("cannot create notes dir");
    dir
}

type SettingsStore = std::sync::Arc<tauri_plugin_store::Store<tauri::Wry>>;

fn settings_store(app: &AppHandle) -> Option<SettingsStore> {
    app.store("settings.json").ok()
}

fn is_onboarded(app: &AppHandle) -> bool {
    settings_store(app)
        .and_then(|s| s.get("onboarded"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn mark_onboarded(app: &AppHandle) {
    if let Some(store) = settings_store(app) {
        store.set("onboarded", true);
        let _ = store.save();
    }
}

fn skills_seeded(app: &AppHandle) -> bool {
    settings_store(app)
        .and_then(|s| s.get("skillsSeeded"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn mark_skills_seeded(app: &AppHandle) {
    if let Some(store) = settings_store(app) {
        store.set("skillsSeeded", true);
        let _ = store.save();
    }
}

fn get_sync_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    let store = settings_store(app)?;
    let value = store.get("syncFolder")?;
    let path = value.as_str()?.to_string();
    if path.trim().is_empty() {
        None
    } else {
        Some(std::path::PathBuf::from(path))
    }
}

fn set_sync_dir_value(app: &AppHandle, path: Option<&str>) {
    if let Some(store) = settings_store(app) {
        match path {
            Some(p) => store.set("syncFolder", p),
            None => store.set("syncFolder", serde_json::Value::Null),
        }
        let _ = store.save();
    }
}

/// Run a two-way mirror between notes dir and sync folder; report failures
/// to the frontend as events (never crash the watcher thread).
fn do_sync(app: &AppHandle) {
    let Some(target) = get_sync_dir(app) else { return };
    let notes_dir = app_data_notes_dir(app);
    match sync::mirror(&notes_dir, &target) {
        Ok(report) => {
            if report.copied_in + report.copied_out + report.resolved > 0 {
                let _ = app.emit(
                    "sync://status",
                    serde_json::json!({
                        "copiedOut": report.copied_out,
                        "copiedIn": report.copied_in,
                        "resolved": report.resolved,
                    }),
                );
                if let Ok(mut store) = app.state::<AppState>().store.lock() {
                    store.reload();
                }
            }
        }
        Err(e) => eprintln!("sync failed: {e}"),
    }
    let local_att = app_data_dir(app).join("attachments");
    if let Err(e) = sync::mirror_attachments(&local_att, &target.join("attachments")) {
        eprintln!("attachment sync failed: {e}");
    }
}

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn toggle_quick_capture(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("quickcapture") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
            let _ = app.emit("quickcapture://shown", ());
        }
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
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Second launch: focus the main window; if argv carries a deep
            // link, forward it to the frontend.
            show_main(app);
            if let Some(url) = argv.iter().find(|a| a.starts_with("dntnote://")) {
                let _ = app.emit("deep-link://url", url.clone());
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
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

            if !skills_seeded(&handle) {
                match commands::skills::skills_dir(&handle)
                    .and_then(|d| commands::skills::seed_bundled(&d).map_err(|e| e.to_string()))
                {
                    Ok(_) => mark_skills_seeded(&handle),
                    Err(e) => eprintln!("seed skills: {e}"),
                }
            }

            // Clean attachments no note references anymore.
            {
                let refs = notes_store.attachment_refs();
                let att_dir = app_data_dir(&handle).join("attachments");
                if let Err(e) = notes_core::attachments::cleanup_orphans(
                    &att_dir,
                    &refs,
                    notes_core::attachments::ORPHAN_GRACE,
                ) {
                    eprintln!("attachment cleanup: {e}");
                }
            }

            app.manage(AppState {
                store: std::sync::Mutex::new(notes_store),
                sync_lock: std::sync::Mutex::new(()),
            });

            // Watcher → reload store → sync (if configured) → notify frontend.
            {
                let handle = handle.clone();
                let notes_dir = notes_dir.clone();
                std::thread::spawn(move || {
                    let result = NotesWatcher::start(&notes_dir, 300, move |ids| {
                        let state = handle.state::<AppState>();
                        let _sync_guard = state.sync_lock.lock();
                        if let Ok(mut store) = state.store.lock() {
                            store.reload();
                        }
                        drop(_sync_guard);
                        do_sync(&handle);
                        let _ = handle.emit("notes://changed", &ids);
                    });
                    if let Err(e) = result {
                        eprintln!("watcher failed: {e}");
                    }
                });
            }

            // Watch the sync folder as well (external changes → mirror in).
            {
                let handle = handle.clone();
                if let Some(sync_dir) = get_sync_dir(&handle) {
                    std::thread::spawn(move || {
                        if let Ok(w) = NotesWatcher::start(&sync_dir, 500, move |_ids| {
                            do_sync(&handle);
                        }) {
                            std::mem::forget(w); // live for the app lifetime
                        }
                    });
                }
            }

            // Global shortcut: Ctrl+Shift+N → quick capture.
            {
                let handle = handle.clone();
                app.global_shortcut().on_shortcut("Ctrl+Shift+N", move |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_quick_capture(&handle);
                    }
                })?;
            }

            // Tray icon with menu.
            {
                let open = MenuItem::with_id(app, "tray-open", "Mở DNT Note", true, None::<&str>)?;
                let quick = MenuItem::with_id(app, "tray-quick", "Quick capture (Ctrl+Shift+N)", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "tray-quit", "Thoát", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&open, &quick, &quit])?;
                TrayIconBuilder::with_id("main-tray")
                    .icon(app.default_window_icon().expect("no icon").clone())
                    .tooltip("DNT Note")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "tray-open" => show_main(app),
                        "tray-quick" => toggle_quick_capture(app),
                        "tray-quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                            show_main(tray.app_handle());
                        }
                    })
                    .build(app)?;
            }

            // Deep link: dntnote://note/<id> → forward to frontend + focus.
            {
                let handle = handle.clone();
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        let _ = handle.emit("deep-link://url", url.to_string());
                        if url.path().starts_with("/note/") {
                            show_main(&handle);
                        }
                    }
                });
            }

            // Initial sync from the cloud folder on startup.
            {
                let handle = handle.clone();
                std::thread::spawn(move || do_sync(&handle));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::skills::list_skills,
            commands::skills::read_skill,
            commands::skills::save_skill,
            commands::skills::delete_skill,
            commands::skills::set_skill_enabled,
            commands::skills::skills_dir_path,
            commands::notes::list_notes,
            commands::notes::read_note,
            commands::notes::create_note,
            commands::notes::update_note,
            commands::notes::delete_note,
            commands::notes::restore_note,
            commands::notes::list_versions,
            commands::notes::read_version,
            commands::notes::restore_version,
            commands::notes::snapshot_note,
            commands::notes::search_notes,
            commands::notes::get_backlinks,
            commands::notes::list_tags,
            commands::notes::empty_trash,
            commands::stats::get_stats,
            commands::semantic::load_embeddings,
            commands::semantic::save_embeddings,
            commands::chats::list_chats,
            commands::chats::load_chat,
            commands::chats::save_chat,
            commands::chats::delete_chat,
            commands::attachments::attach_file,
            commands::attachments::list_attachments,
            commands::attachments::extract_attachment_text,
            commands::attachments::prepare_attachment_image,
            commands::attachments::cleanup_orphan_attachments,
            commands::media::list_media,
            commands::media::rename_media,
            commands::media::delete_media,
            commands::media::import_media,
            commands::media::attach_bytes,
            commands::media::import_media_bytes,
            commands::media::attachments_dir_path,
            commands::sync::set_sync_folder,
            commands::sync::get_sync_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
