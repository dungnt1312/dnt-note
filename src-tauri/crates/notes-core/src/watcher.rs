use crate::error::{NoteError, Result};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, DebouncedEvent};
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Watches a notes directory and reports changed note ids (file stem of
/// `.md` files directly inside the dir — `.trash/` and other files ignored).
pub struct NotesWatcher;

/// Dropping the handle keeps the watcher alive (its thread is detached);
/// call `stop()` to end it explicitly.
pub struct WatcherHandle {
    stop_flag: Arc<Mutex<bool>>,
}

impl WatcherHandle {
    pub fn stop(self) {
        if let Ok(mut flag) = self.stop_flag.lock() {
            *flag = true;
        }
    }
}

fn note_id_from_event_path(path: &Path, notes_dir: &Path) -> Option<String> {
    let rel = path.strip_prefix(notes_dir).ok()?;
    let mut comps = rel.components();
    // First component must be a plain `.md` file directly in notes_dir.
    let first = comps.next()?;
    let name = first.as_os_str().to_str()?;
    if comps.next().is_some() || !name.ends_with(".md") {
        return None;
    }
    Some(name.trim_end_matches(".md").to_string())
}

fn changed_ids(events: &[DebouncedEvent], notes_dir: &Path) -> Vec<String> {
    let mut ids: Vec<String> = events
        .iter()
        .flat_map(|e| e.paths.iter())
        .filter_map(|p| note_id_from_event_path(p, notes_dir))
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

impl NotesWatcher {
    pub fn start(
        notes_dir: &Path,
        debounce_ms: u64,
        on_change: impl Fn(Vec<String>) + Send + 'static,
    ) -> Result<WatcherHandle> {
        let (tx, rx) = channel::<DebounceEventResult>();
        let mut debouncer = new_debouncer(Duration::from_millis(debounce_ms), None, tx)
            .map_err(|e| NoteError::Unknown(format!("watcher init: {e}")))?;
        debouncer
            .watch(notes_dir, notify::RecursiveMode::NonRecursive)
            .map_err(|e| NoteError::Unknown(format!("watch: {e}")))?;
        // Watch trash dir too so restore()/delete() from the app surface as
        // external-style changes to any other observer (harmless here).
        let _ = debouncer.watch(&notes_dir.join(".trash"), notify::RecursiveMode::NonRecursive);

        let dir: PathBuf = notes_dir.to_path_buf();
        let stop_flag = Arc::new(Mutex::new(false));
        let stop_for_thread = stop_flag.clone();

        std::thread::spawn(move || {
            let mut _debouncer = debouncer; // keep alive
            loop {
                if *stop_for_thread.lock().unwrap_or_else(|p| p.into_inner()) {
                    break;
                }
                match rx.recv_timeout(Duration::from_millis(200)) {
                    Ok(Ok(events)) => {
                        let ids = changed_ids(&events, &dir);
                        if !ids.is_empty() {
                            on_change(ids);
                        }
                    }
                    Ok(Err(_)) => continue, // transient fs errors — next event retries
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        Ok(WatcherHandle { stop_flag })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn wait_for_ids(rx: &mpsc::Receiver<Vec<String>>) -> Option<Vec<String>> {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut seen: Vec<String> = vec![];
        while std::time::Instant::now() < deadline {
            if let Ok(ids) = rx.try_recv() {
                seen.extend(ids);
                if !seen.is_empty() {
                    // drain a moment for possible dupes, then return
                    std::thread::sleep(Duration::from_millis(150));
                    while let Ok(more) = rx.try_recv() {
                        seen.extend(more);
                    }
                    seen.sort();
                    seen.dedup();
                    return Some(seen);
                }
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        None
    }

    #[test]
    fn reports_created_note_id() {
        let tmp = tempfile::TempDir::new().unwrap();
        let dir = tmp.path().join("notes");
        std::fs::create_dir_all(&dir).unwrap();
        let (tx, rx) = mpsc::channel();
        let handle = NotesWatcher::start(&dir, 100, move |ids| tx.send(ids).unwrap()).unwrap();
        std::fs::write(dir.join("hello.md"), "content").unwrap();
        let ids = wait_for_ids(&rx).expect("no callback within 5s");
        assert_eq!(ids, vec!["hello".to_string()]);
        handle.stop();
    }

    #[test]
    fn ignores_trash_and_non_md() {
        let tmp = tempfile::TempDir::new().unwrap();
        let dir = tmp.path().join("notes");
        std::fs::create_dir_all(dir.join(".trash")).unwrap();
        let (tx, rx) = mpsc::channel();
        let handle = NotesWatcher::start(&dir, 100, move |ids| tx.send(ids).unwrap()).unwrap();
        std::fs::write(dir.join(".trash").join("x.md"), "trashed").unwrap();
        std::fs::write(dir.join("notes.txt"), "not a note").unwrap();
        std::thread::sleep(Duration::from_millis(700));
        assert!(rx.try_recv().is_err(), "should not report trash/non-md changes");
        handle.stop();
    }
}
