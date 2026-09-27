use notes_core::skills::{self, Skill, SkillMeta};
use std::path::PathBuf;
use tauri::Manager;

type CmdResult<T> = Result<T, String>;

/// Bundled sample skills, embedded like the demo notes.
pub const BUNDLED: [(&str, &str); 3] = [
    ("meeting-notes", include_str!("../../resources/skills/meeting-notes/SKILL.md")),
    ("weekly-review", include_str!("../../resources/skills/weekly-review/SKILL.md")),
    ("flashcards", include_str!("../../resources/skills/flashcards/SKILL.md")),
];

fn err_of(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub(crate) fn skills_dir(app: &tauri::AppHandle) -> CmdResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Lỗi đọc/ghi skill: {e}"))?
        .join("skills");
    std::fs::create_dir_all(&dir).map_err(err_of)?;
    Ok(dir)
}

/// Write bundled skills that don't exist yet; returns the number written.
pub fn seed_bundled(dir: &std::path::Path) -> notes_core::error::Result<usize> {
    skills::seed_embedded(dir, &BUNDLED)
}

#[tauri::command]
pub fn list_skills(app: tauri::AppHandle) -> CmdResult<Vec<SkillMeta>> {
    Ok(skills::list_skills(&skills_dir(&app)?))
}

#[tauri::command]
pub fn read_skill(app: tauri::AppHandle, name: String) -> CmdResult<Skill> {
    skills::read_skill(&skills_dir(&app)?, &name).map_err(err_of)
}

#[tauri::command]
pub fn save_skill(app: tauri::AppHandle, skill: Skill) -> CmdResult<()> {
    skills::save_skill(&skills_dir(&app)?, &skill).map_err(err_of)
}

#[tauri::command]
pub fn delete_skill(app: tauri::AppHandle, name: String) -> CmdResult<()> {
    skills::delete_skill(&skills_dir(&app)?, &name).map_err(err_of)
}

#[tauri::command]
pub fn set_skill_enabled(app: tauri::AppHandle, name: String, enabled: bool) -> CmdResult<()> {
    skills::set_skill_enabled(&skills_dir(&app)?, &name, enabled).map_err(err_of)
}

#[tauri::command]
pub fn skills_dir_path(app: tauri::AppHandle) -> CmdResult<String> {
    Ok(skills_dir(&app)?.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_skills_parse_and_seed() {
        for (name, text) in BUNDLED {
            assert_eq!(skills::parse_skill(text).unwrap().name, name);
        }
        let tmp = tempfile::TempDir::new().unwrap();
        assert_eq!(seed_bundled(tmp.path()).unwrap(), 3);
        assert_eq!(seed_bundled(tmp.path()).unwrap(), 0);
        assert_eq!(skills::list_skills(tmp.path()).len(), 3);
    }
}
