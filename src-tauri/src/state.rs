use notes_core::store::NotesStore;
use std::sync::Mutex;

pub struct AppState {
    pub store: Mutex<NotesStore>,
}
