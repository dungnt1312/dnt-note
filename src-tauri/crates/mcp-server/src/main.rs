mod protocol;

use notes_core::store::NotesStore;
use serde_json::Value;
use std::io::{BufRead, Write};
use std::path::PathBuf;

/// Same location the Tauri app uses: %APPDATA%\com.dungnt.dntnote
fn default_data_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(|d| PathBuf::from(d).join("com.dungnt.dntnote"))
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn main() {
    let notes_dir = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| default_data_dir().join("notes"));

    let mut store = match NotesStore::new(notes_dir.clone()) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("dnt-note-mcp: cannot open notes dir {:?}: {e}", notes_dir);
            std::process::exit(1);
        }
    };

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            let err = serde_json::json!({
                "jsonrpc": "2.0", "id": null,
                "error": { "code": -32700, "message": "Parse error" }
            });
            writeln!(out, "{err}").ok();
            out.flush().ok();
            continue;
        };
        // Reload before handling so edits from the app (or cloud sync) are
        // visible immediately — cheap at note-app scale.
        store.reload();
        if let Some(response) = protocol::handle_message(&msg, &mut store) {
            writeln!(out, "{response}").ok();
            out.flush().ok();
        }
    }
}
