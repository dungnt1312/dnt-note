use crate::error::{NoteError, Result};
use crate::store::write_atomic;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const MAX_NAME_LEN: usize = 80;

/// Validate + normalize a folder name: trim, non-empty, <= 80 chars.
pub fn validate_name(raw: &str) -> Result<String> {
    let name = raw.trim().to_string();
    if name.is_empty() {
        return Err(NoteError::Unknown("folder name is empty".into()));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(NoteError::Unknown(format!(
            "folder name exceeds {MAX_NAME_LEN} characters"
        )));
    }
    Ok(name)
}

/// Folder names match case-insensitively (Unicode-aware, covers Vietnamese).
pub fn eq_ci(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

#[derive(Serialize, Deserialize, Default)]
struct FolderFile {
    names: Vec<String>,
}

/// On-disk registry of folder names (`folders.json`). Notes also carry the
/// folder — the registry only keeps empty folders alive; the displayed list
/// is the union of registry names and folder values found on notes.
pub struct FolderRegistry {
    path: PathBuf,
    names: Vec<String>,
}

impl FolderRegistry {
    pub fn load(path: PathBuf) -> Self {
        let names = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<FolderFile>(&s).ok())
            .map(|f| f.names)
            .unwrap_or_default();
        FolderRegistry { path, names }
    }

    pub fn names(&self) -> &[String] {
        &self.names
    }

    pub fn add(&mut self, name: &str) -> Result<()> {
        self.names.push(name.to_string());
        self.save()
    }

    /// Replace `old` (case-insensitive) with `new`; adds `new` if `old` absent.
    pub fn replace(&mut self, old: &str, new: &str) -> Result<()> {
        match self.names.iter().position(|n| eq_ci(n, old)) {
            Some(pos) => self.names[pos] = new.to_string(),
            None => self.names.push(new.to_string()),
        }
        self.save()
    }

    pub fn remove(&mut self, name: &str) -> Result<()> {
        self.names.retain(|n| !eq_ci(n, name));
        self.save()
    }

    fn save(&self) -> Result<()> {
        let json = serde_json::to_string_pretty(&FolderFile {
            names: self.names.clone(),
        })
        .map_err(|e| NoteError::Unknown(e.to_string()))?;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        write_atomic(&self.path, json.as_bytes())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn registry(tmp: &TempDir) -> FolderRegistry {
        FolderRegistry::load(tmp.path().join("folders.json"))
    }

    #[test]
    fn validate_trims_and_rejects_empty_or_too_long() {
        assert_eq!(validate_name("  Công việc  ").unwrap(), "Công việc");
        assert!(validate_name("   ").is_err());
        let long = "x".repeat(MAX_NAME_LEN + 1);
        assert!(validate_name(&long).is_err());
        assert!(validate_name(&"x".repeat(MAX_NAME_LEN)).is_ok());
    }

    #[test]
    fn eq_ci_ignores_unicode_case() {
        assert!(eq_ci("Work", "work"));
        assert!(eq_ci("Đồ án", "đồ án"));
        assert!(!eq_ci("Work", " Works"));
    }

    #[test]
    fn add_replace_remove_persist_across_reopen() {
        let tmp = TempDir::new().unwrap();
        let mut reg = registry(&tmp);
        reg.add("Work").unwrap();
        reg.add("Life").unwrap();
        reg.replace("work", "Việc làm").unwrap();
        reg.remove("LIFE").unwrap();
        // Reopen from disk.
        let reg2 = registry(&tmp);
        assert_eq!(reg2.names(), &["Việc làm".to_string()]);
    }

    #[test]
    fn load_missing_file_yields_empty() {
        let tmp = TempDir::new().unwrap();
        assert!(registry(&tmp).names().is_empty());
    }
}
