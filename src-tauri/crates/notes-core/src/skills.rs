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

fn io_err(e: impl std::fmt::Display) -> NoteError {
    NoteError::Unknown(format!("Lỗi đọc/ghi skill: {e}"))
}

fn not_found(name: &str) -> NoteError {
    NoteError::Unknown(format!("Không tìm thấy skill “{name}”"))
}

/// Single-pass unescape of `\\` and `\"` inside a double-quoted value.
fn unescape(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    let mut chars = v.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some(n @ ('\\' | '"')) => out.push(n),
                Some(n) => {
                    out.push('\\');
                    out.push(n);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn unquote(v: &str) -> String {
    let v = v.trim();
    if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') {
        unescape(&v[1..v.len() - 1])
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
            "description" => {
                if matches!(v.trim(), ">" | "|" | ">-" | "|-" | ">+" | "|+") {
                    return Err(invalid("Mô tả skill không hỗ trợ block scalar (> hoặc |); hãy viết trên một dòng"));
                }
                description = unquote(v)
            }
            "enabled" => {
                enabled = match unquote(v).to_lowercase().as_str() {
                    "true" | "yes" | "1" => true,
                    "false" | "no" | "0" => false,
                    _ => return Err(invalid("Giá trị enabled của skill phải là true/false")),
                }
            }
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
    let text = fs::read_to_string(&path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => not_found(name),
        _ => io_err(e),
    })?;
    let skill = parse_skill(&text)?;
    if skill.name != name {
        return Err(invalid("Tên trong SKILL.md không khớp tên thư mục"));
    }
    Ok(skill)
}

pub fn save_skill(dir: &Path, skill: &Skill) -> Result<()> {
    validate(skill)?;
    let folder = dir.join(&skill.name);
    fs::create_dir_all(&folder).map_err(io_err)?;
    write_atomic(&folder.join("SKILL.md"), serialize_skill(skill).as_bytes()).map_err(|e| match e {
        NoteError::Io(e) => io_err(e),
        other => other,
    })
}

pub fn delete_skill(dir: &Path, name: &str) -> Result<()> {
    if !is_valid_name(name) {
        return Err(invalid("Tên skill không hợp lệ"));
    }
    let folder = dir.join(name);
    if !folder.is_dir() {
        return Err(not_found(name));
    }
    fs::remove_dir_all(folder).map_err(io_err)?;
    Ok(())
}

pub fn set_skill_enabled(dir: &Path, name: &str, enabled: bool) -> Result<()> {
    let mut skill = read_skill(dir, name)?;
    skill.enabled = enabled;
    save_skill(dir, &skill)
}

/// Write in-memory `(name, SKILL.md text)` pairs, skipping existing folders.
pub fn seed_embedded(dst_dir: &Path, skills: &[(&str, &str)]) -> Result<usize> {
    let mut count = 0;
    for (name, text) in skills {
        let target = dst_dir.join(name);
        if target.exists() {
            continue;
        }
        fs::create_dir_all(&target).map_err(io_err)?;
        write_atomic(&target.join("SKILL.md"), text.as_bytes()).map_err(io_err)?;
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
    fn seed_embedded_skips_existing() {
        let tmp = TempDir::new().unwrap();
        let mut custom = sample("one");
        custom.body = "custom".into();
        save_skill(tmp.path(), &custom).unwrap();
        let one = serialize_skill(&sample("one"));
        let two = serialize_skill(&sample("two"));
        assert_eq!(seed_embedded(tmp.path(), &[("one", &one), ("two", &two)]).unwrap(), 1);
        assert_eq!(read_skill(tmp.path(), "one").unwrap().body, "custom");
        assert_eq!(list_skills(tmp.path()).len(), 2);
    }

    #[test]
    fn errors_are_vietnamese() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(read_skill(tmp.path(), "abc").unwrap_err().to_string(), "Không tìm thấy skill “abc”");
        assert_eq!(delete_skill(tmp.path(), "abc").unwrap_err().to_string(), "Không tìm thấy skill “abc”");
        let file = tmp.path().join("file");
        fs::write(&file, "x").unwrap();
        let e = save_skill(&file, &sample("abc")).unwrap_err().to_string();
        assert!(e.starts_with("Lỗi đọc/ghi skill: "), "{e}");
    }

    #[test]
    fn unescape_mixed_and_block_scalars_and_enabled() {
        // raw file text: description: "x \\\" y \" z \\"
        let t = r#"---
name: a
description: "x \\\" y \" z \\"
---
"#;
        assert_eq!(parse_skill(t).unwrap().description, r#"x \" y " z \"#);
        let mut s = sample("a");
        s.description = r#"a\"b\c""#.into();
        assert_eq!(parse_skill(&serialize_skill(&s)).unwrap().description, s.description);
        for bad in [">", "|"] {
            let e = parse_skill(&format!("---\nname: a\ndescription: {bad}\n  x\n---\n")).unwrap_err();
            assert!(e.to_string().contains("block scalar"));
        }
        for (v, want) in [("YES", true), ("0", false), ("False", false), ("1", true)] {
            let t = format!("---\nname: a\ndescription: d\nenabled: {v}\n---\n");
            assert_eq!(parse_skill(&t).unwrap().enabled, want);
        }
        assert!(parse_skill("---\nname: a\ndescription: d\nenabled: maybe\n---\n").is_err());
    }
}
