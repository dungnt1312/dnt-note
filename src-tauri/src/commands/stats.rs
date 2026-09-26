use crate::state::AppState;
use notes_core::note::Stats;
use tauri::State;

#[tauri::command]
pub fn get_stats(state: State<AppState>) -> Result<Stats, String> {
    let store = state.store.lock().map_err(|e| format!("lock: {e}"))?;
    Ok(store.stats())
}
