use notes_core::store::NotesStore;
use std::sync::Mutex;

pub struct AppState {
    pub store: Mutex<NotesStore>,
    /// Serializes mirror/sync passes against watcher-triggered reloads.
    pub sync_lock: Mutex<()>,
}
