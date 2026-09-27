//! Agent Skills: `<skills_dir>/<name>/SKILL.md` with a small YAML frontmatter
//! (`name`, `description`, optional `enabled`). Unknown keys are dropped.

use crate::error::{NoteError, Result};
use crate::store::write_atomic;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMeta {
    pub name: String,
    pub description: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub name: String,
    pub description: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub body: String,
}

fn default_true() -> bool {
    true
}

impl Skill {
    pub fn meta(&self) -> SkillMeta {
        SkillMeta { name: self.name.clone(), description: self.description.clone(), enabled: self.enabled }
    }
}

pub fn is_valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn invalid(msg: &str) -> NoteError {
    NoteError::Unknown(msg.to_string())
}

fn unquote(v: &str) -> String {
    let v = v.trim();
    if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') {
        v[1..v.len() - 1].replace("\\\"", "\"").replace("\\\\", "\\")
    } else if v.len() >= 2 && v.starts_with('\'') && v.ends_with('\'') {
        v[1..v.len() - 1].replace("''", "'")
    } else {
        v.to_string()
    }
}

fn validate(skill: &Skill) -> Result<()> {
    if !is_valid_name(&skill.name) {
        return Err(invalid("Tên skill không hợp lệ (chỉ a-z, 0-9, '-', tối đa 64 ký tự)"));
    }
    let d = skill.description.trim();
    if d.is_empty() {
        return Err(invalid("Skill thiếu mô tả (description)"));
    }
    if d.contains('\n') || d.chars().count() > 1024 {
        return Err(invalid("Mô tả skill phải là một dòng, tối đa 1024 ký tự"));
    }
    Ok(())
}

pub fn parse_skill(text: &str) -> Result<Skill> {
    let text = text.replace("\r\n", "\n");
    let rest = text
        .strip_prefix("---\n")
        .ok_or_else(|| invalid("SKILL.md thiếu frontmatter"))?;
    let (fm, body) = if let Some(i) = rest.find("\n---\n") {
        (&rest[..i], &rest[i + 5..])
    } else if let Some(fm) = rest.strip_suffix("\n---") {
        (fm, "")
    } else if let Some(body) = rest.strip_prefix("---\n") {
        ("", body)
    } else {
        return Err(invalid("SKILL.md thiếu dòng đóng frontmatter"));
    };
    let (mut name, mut description, mut enabled) = (String::new(), String::new(), true);
    for line in fm.lines() {
        let Some((k, v)) = line.split_once(':') else { continue };
        match k.trim() {
            "name" => name = unquote(v),
            "description" => description = unquote(v),
            "enabled" => enabled = !matches!(unquote(v).to_lowercase().as_str(), "false" | "no" | "0"),
            _ => {}
        }
    }
    let skill = Skill { name, description, enabled, body: body.to_string() };
    validate(&skill)?;
    Ok(skill)
}

fn quote(v: &str) -> String {
    format!("\"{}\"", v.replace('\\', "\\\\").replace('"', "\\\""))
}

pub fn serialize_skill(skill: &Skill) -> String {
    format!(
        "---\nname: {}\ndescription: {}\nenabled: {}\n---\n{}",
        skill.name,
        quote(skill.description.trim()),
        skill.enabled,
        skill.body
    )
}

pub fn list_skills(dir: &Path) -> Vec<SkillMeta> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<SkillMeta> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let folder = e.file_name().to_string_lossy().to_string();
            let text = fs::read_to_string(e.path().join("SKILL.md")).ok()?;
            let skill = parse_skill(&text).ok()?;
            (skill.name == folder).then(|| skill.meta())
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

pub fn read_skill(dir: &Path, name: &str) -> Result<Skill> {
    if !is_valid_name(name) {
        return Err(invalid("Tên skill không hợp lệ"));
    }
    let path = dir.join(name).join("SKILL.md");
    let text = fs::read_to_string(&path).map_err(|_| NoteError::NotFound(format!("skill {name}")))?;
    let skill = parse_skill(&text)?;
    if skill.name != name {
        return Err(invalid("Tên trong SKILL.md không khớp tên thư mục"));
    }
    Ok(skill)
}

pub fn save_skill(dir: &Path, skill: &Skill) -> Result<()> {
    validate(skill)?;
    let folder = dir.join(&skill.name);
    fs::create_dir_all(&folder)?;
    write_atomic(&folder.join("SKILL.md"), serialize_skill(skill).as_bytes())
}

pub fn delete_skill(dir: &Path, name: &str) -> Result<()> {
    if !is_valid_name(name) {
        return Err(invalid("Tên skill không hợp lệ"));
    }
    let folder = dir.join(name);
    if !folder.is_dir() {
        return Err(NoteError::NotFound(format!("skill {name}")));
    }
    fs::remove_dir_all(folder)?;
    Ok(())
}

pub fn set_skill_enabled(dir: &Path, name: &str, enabled: bool) -> Result<()> {
    let mut skill = read_skill(dir, name)?;
    skill.enabled = enabled;
    save_skill(dir, &skill)
}

/// Copy `<src>/<name>/SKILL.md` into `dst` for skills not yet present.
pub fn seed_from(src_dir: &Path, dst_dir: &Path) -> Result<usize> {
    let mut count = 0;
    for e in fs::read_dir(src_dir)?.flatten() {
        let src = e.path().join("SKILL.md");
        if !src.is_file() {
            continue;
        }
        let target = dst_dir.join(e.file_name());
        if target.exists() {
            continue;
        }
        fs::create_dir_all(&target)?;
        fs::copy(&src, target.join("SKILL.md"))?;
        count += 1;
    }
    Ok(count)
}

/// Write in-memory `(name, SKILL.md text)` pairs, skipping existing folders.
pub fn seed_embedded(dst_dir: &Path, skills: &[(&str, &str)]) -> Result<usize> {
    let mut count = 0;
    for (name, text) in skills {
        let target = dst_dir.join(name);
        if target.exists() {
            continue;
        }
        fs::create_dir_all(&target)?;
        write_atomic(&target.join("SKILL.md"), text.as_bytes())?;
        count += 1;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sample(name: &str) -> Skill {
        Skill {
            name: name.into(),
            description: "Mô tả \"có\" ngoặc: và dấu hai chấm".into(),
            enabled: false,
            body: "# Hướng dẫn\n\n---\nnội dung\n".into(),
        }
    }

    #[test]
    fn roundtrip() {
        let s = sample("meeting-notes");
        assert_eq!(parse_skill(&serialize_skill(&s)).unwrap(), s);
    }

    #[test]
    fn parses_crlf_quotes_and_default_enabled() {
        let t = "---\r\nname: abc\r\ndescription: 'It''s ok'\r\nfoo: bar\r\n---\r\nbody\r\n";
        let s = parse_skill(t).unwrap();
        assert_eq!(s.description, "It's ok");
        assert!(s.enabled);
        assert_eq!(s.body, "body\n");
    }

    #[test]
    fn rejects_invalid() {
        assert!(parse_skill("---\nname: Bad Name\ndescription: x\n---\n").is_err());
        assert!(parse_skill("---\nname: ok\n---\n").is_err());
        assert!(parse_skill("no frontmatter").is_err());
        let tmp = TempDir::new().unwrap();
        assert!(save_skill(tmp.path(), &sample("../evil")).is_err());
        assert!(delete_skill(tmp.path(), "..").is_err());
        assert!(!is_valid_name(&"a".repeat(65)));
    }

    #[test]
    fn list_read_toggle_delete() {
        let tmp = TempDir::new().unwrap();
        let d = tmp.path();
        save_skill(d, &sample("zeta")).unwrap();
        save_skill(d, &sample("alpha")).unwrap();
        fs::create_dir_all(d.join("broken")).unwrap();
        fs::write(d.join("broken/SKILL.md"), "garbage").unwrap();
        fs::create_dir_all(d.join("empty")).unwrap();
        let names: Vec<_> = list_skills(d).into_iter().map(|m| m.name).collect();
        assert_eq!(names, vec!["alpha", "zeta"]);
        set_skill_enabled(d, "alpha", true).unwrap();
        assert!(read_skill(d, "alpha").unwrap().enabled);
        delete_skill(d, "alpha").unwrap();
        assert!(!d.join("alpha").exists());
        assert!(read_skill(d, "alpha").is_err());
        assert!(list_skills(&d.join("missing")).is_empty());
    }

    #[test]
    fn seed_copies_only_missing() {
        let tmp = TempDir::new().unwrap();
        let (src, dst) = (tmp.path().join("src"), tmp.path().join("dst"));
        save_skill(&src, &sample("one")).unwrap();
        save_skill(&src, &sample("two")).unwrap();
        let mut custom = sample("one");
        custom.body = "custom".into();
        save_skill(&dst, &custom).unwrap();
        assert_eq!(seed_from(&src, &dst).unwrap(), 1);
        assert_eq!(read_skill(&dst, "one").unwrap().body, "custom");
        assert_eq!(seed_from(&src, &dst).unwrap(), 0);
        let text = serialize_skill(&sample("three"));
        assert_eq!(seed_embedded(&dst, &[("three", &text)]).unwrap(), 1);
        assert_eq!(list_skills(&dst).len(), 3);
    }
}
