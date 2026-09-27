use crate::error::{NoteError, Result};
use base64::Engine as _;
use std::fs;
use std::io::Read;
use std::path::Path;

pub const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_FILES_PER_NOTE: usize = 10;
pub const MAX_IMAGE_EDGE_PX: u32 = 2048;
/// Orphaned attachments younger than this are kept (the app passes it to `cleanup_orphans`).
pub const ORPHAN_GRACE: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 60 * 60);

/// Extensions accepted as attachments (parity with NoteStudio).
pub const ALLOWED_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", // images
    "pdf", "docx", "rtf", "odt", "txt", "md", "csv", "json",
    "rs", "py", "js", "ts", "tsx", "jsx", "go", "java", "c", "cpp", "html", "css", "toml", "yaml", "yml", "xml", "sh",
    "mp3", "wav", "webm", "m4a", "ogg", // audio
];

pub fn is_allowed(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| ALLOWED_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// A `(attachments/<raw>)` occurrence: byte span of the whole parenthesised
/// destination (including both parens) and the trimmed raw target.
#[derive(Debug, Clone, PartialEq)]
pub struct LinkTarget {
    pub start: usize,
    pub end: usize,
    pub raw: String,
}

/// Scan `(attachments/...)` destinations. Parens inside the name must be
/// balanced (e.g. `image (1).png`); a link that hits a newline is ignored.
pub fn link_targets(body: &str) -> Vec<LinkTarget> {
    const MARK: &str = "(attachments/";
    let mut out = Vec::new();
    let mut offset = 0;
    while let Some(pos) = body[offset..].find(MARK) {
        let start = offset + pos;
        let inner = start + MARK.len();
        let mut depth = 1usize;
        let mut end = None;
        for (i, ch) in body[inner..].char_indices() {
            match ch {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(inner + i);
                        break;
                    }
                }
                '\n' => break,
                _ => {}
            }
        }
        let Some(end) = end else {
            offset = inner;
            continue;
        };
        out.push(LinkTarget { start, end: end + 1, raw: body[inner..end].trim().to_string() });
        offset = end + 1;
    }
    out
}

/// Safe file names a raw link target may refer to: the raw text and its
/// percent-decoded form (when different and valid UTF-8).
pub fn target_candidates(raw: &str) -> Vec<String> {
    let mut v = Vec::new();
    if is_safe_name(raw) {
        v.push(raw.to_string());
    }
    if let Some(d) = percent_decode(raw) {
        if d != raw && is_safe_name(&d) {
            v.push(d);
        }
    }
    v
}

/// True when a link target refers to `name` in raw or decoded form.
pub fn target_matches(raw: &str, name: &str) -> bool {
    target_candidates(raw).iter().any(|c| c == name)
}

/// Names referenced in a note body (raw and decoded candidates, deduped).
pub fn refs_in_body(body: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in link_targets(body) {
        for c in target_candidates(&t.raw) {
            if !out.contains(&c) {
                out.push(c);
            }
        }
    }
    out
}

/// Number of distinct attachment files in a body, keyed by canonical
/// (decoded when safe, else raw) name so `a b` and `a%20b` count once.
pub fn unique_ref_count(body: &str) -> usize {
    let mut seen = std::collections::HashSet::new();
    for t in link_targets(body) {
        if let Some(c) = target_candidates(&t.raw).pop() {
            seen.insert(c);
        }
    }
    seen.len()
}

/// In-flight copy temp file (`.<name>.part`); skipped by scans.
pub fn is_temp_name(name: &str) -> bool {
    name.starts_with('.') && name.ends_with(".part")
}

/// Canonical link encoding: `%` -> `%25`, space -> `%20`, nothing else.
pub fn encode_link_name(name: &str) -> String {
    name.replace('%', "%25").replace(' ', "%20")
}

/// Decode `%XX` escapes; `None` if the result is not valid UTF-8.
/// Malformed escapes are kept literally.
pub fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() && b[i + 1].is_ascii_hexdigit() && b[i + 2].is_ascii_hexdigit() {
            let hex = |c: u8| (c as char).to_digit(16).unwrap_or(0) as u8;
            out.push(hex(b[i + 1]) * 16 + hex(b[i + 2]));
            i += 3;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8(out).ok()
}

/// A bare file name that is safe on every platform: no separators, no ':'
/// (NTFS streams / drive letters), no control chars, and not a Windows
/// reserved device name (with or without extension).
pub fn is_safe_name(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." {
        return false;
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return false;
    }
    if name.chars().any(|c| c == '/' || c == '\\' || c == ':' || (c as u32) < 0x20) {
        return false;
    }
    let stem = name.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    !reserved
}

fn validate_upload(file_name: &str, size: u64) -> Result<()> {
    if !is_safe_name(file_name) {
        return Err(NoteError::Unknown("Tên file không hợp lệ".into()));
    }
    let path = Path::new(file_name);
    if !is_allowed(path) {
        return Err(NoteError::Unknown(format!(
            "Định dạng không hỗ trợ: {}",
            path.extension().and_then(|e| e.to_str()).unwrap_or("?")
        )));
    }
    if size > MAX_FILE_BYTES {
        return Err(NoteError::Unknown(format!(
            "File quá lớn ({:.1}MB, giới hạn 25MB)",
            size as f64 / (1024.0 * 1024.0)
        )));
    }
    Ok(())
}

/// Copy a file into the attachments dir as `<uuid>-<original name>`.
pub fn save_file(attachments_dir: &Path, src: &Path) -> Result<String> {
    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| NoteError::Unknown("Tên file không hợp lệ".into()))?;
    // Name/extension checked before stat-ing so bad types fail fast.
    validate_upload(file_name, 0)?;
    let size = fs::metadata(src)?.len();
    if size > MAX_FILE_BYTES {
        validate_upload(file_name, size)?;
    }
    let stored = format!("{}-{}", uuid::Uuid::new_v4(), file_name);
    fs::create_dir_all(attachments_dir)?;
    fs::copy(src, attachments_dir.join(&stored))?;
    Ok(stored)
}

/// Write raw bytes into the attachments dir as `<uuid>-<file_name>`,
/// with the same validation as `save_file`.
pub fn save_bytes(attachments_dir: &Path, file_name: &str, bytes: &[u8]) -> Result<String> {
    validate_upload(file_name, bytes.len() as u64)?;
    let stored = format!("{}-{}", uuid::Uuid::new_v4(), file_name);
    fs::create_dir_all(attachments_dir)?;
    fs::write(attachments_dir.join(&stored), bytes)?;
    Ok(stored)
}

/// Plain-text-ish extraction for text/code/docx; images return a marker.
/// PDF is handled by the app layer (heavier dependency).
pub fn extract_text(path: &Path) -> Result<String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "docx" => extract_docx(path),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" => Ok("[hình ảnh — dùng vision model để mô tả]".into()),
        _ => {
            let mut text = String::new();
            fs::File::open(path)?.read_to_string(&mut text)?;
            if text.contains('\u{0}') {
                return Err(NoteError::Unknown("File nhị phân không đọc được dưới dạng text".into()));
            }
            Ok(text)
        }
    }
}

/// DOCX = zip with word/document.xml; strip tags, keep paragraph breaks.
fn extract_docx(path: &Path) -> Result<String> {
    let file = fs::File::open(path)?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| NoteError::Unknown(format!("Không đọc được docx: {e}")))?;
    let mut xml = String::new();
    zip.by_name("word/document.xml")
        .map_err(|e| NoteError::Unknown(format!("docx thiếu document.xml: {e}")))?
        .read_to_string(&mut xml)?;

    // Paragraph ends become newlines before stripping the remaining tags.
    let expanded = xml.replace("</w:p>", "\n").replace("<w:br/>", "\n").replace("<w:tab/>", "\t");
    Ok(collapse_blank_lines(&strip_tags(&expanded)))
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

fn collapse_blank_lines(s: &str) -> String {
    let mut out = String::new();
    let mut blank = true;
    for line in s.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            if !blank {
                out.push('\n');
            }
            blank = true;
        } else {
            out.push_str(trimmed);
            out.push('\n');
            blank = false;
        }
    }
    out
}

/// Downscale an image so its longest edge ≤ `max_px`; returns a data URL.
pub fn prepare_image(path: &Path, max_px: u32) -> Result<String> {
    let img = image::open(path).map_err(|e| NoteError::Unknown(format!("Không mở được ảnh: {e}")))?;
    let resized = if img.width().max(img.height()) > max_px {
        img.resize(max_px, max_px, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    let dynamic = resized.to_rgba8();
    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(dynamic)
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| NoteError::Unknown(format!("Encode ảnh: {e}")))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Ok(format!("data:image/png;base64,{b64}"))
}

/// Delete files in attachments_dir not present in `referenced` and last
/// modified more than `min_age` ago (grace period for files whose note has
/// not been saved/synced yet). Returns count.
pub fn cleanup_orphans(
    attachments_dir: &Path,
    referenced: &std::collections::HashSet<String>,
    min_age: std::time::Duration,
) -> Result<usize> {
    cleanup_orphans_in(attachments_dir, referenced, min_age)
}

/// Orphan cleanup for any attachments dir (local or sync mirror). Stale
/// `.part` temp files older than `min_age` are removed as well.
pub fn cleanup_orphans_in(
    dir: &Path,
    referenced: &std::collections::HashSet<String>,
    min_age: std::time::Duration,
) -> Result<usize> {
    let mut removed = 0;
    if !dir.exists() {
        return Ok(0);
    }
    for entry in fs::read_dir(dir)?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
            continue;
        };
        if !is_temp_name(&name) && referenced.contains(&name) {
            continue;
        }
        // Unknown mtime → treat as fresh (never delete on doubt).
        let old_enough = fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age >= min_age);
        if old_enough {
            fs::remove_file(&path)?;
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::io::Write;

    #[test]
    fn refs_in_body_finds_markdown_links() {
        let body = "ảnh: ![a](attachments/x-1.png)\nfile: [b](attachments/y-2.pdf)\nköd: (attachments/../etc)\nempty: ()";
        assert_eq!(refs_in_body(body), vec!["x-1.png", "y-2.pdf"]);
    }

    #[test]
    fn refs_in_body_raw_and_decoded() {
        let body = "![a](attachments/u-my%20pic%20(1).png) [b](attachments/x%2Fy.pdf) [c](attachments/bad%zz.txt)";
        assert_eq!(refs_in_body(body), vec!["u-my%20pic%20(1).png", "u-my pic (1).png", "x%2Fy.pdf", "bad%zz.txt"]);
        // Unsafe decoded forms are dropped.
        assert_eq!(refs_in_body("(attachments/%2E%2E) (attachments/a%00.png)"), vec!["%2E%2E", "a%00.png"]);
        assert_eq!(percent_decode("a%C3%A1").as_deref(), Some("aá"));
        assert_eq!(percent_decode("50%").as_deref(), Some("50%"));
        assert_eq!(percent_decode("%FF"), None);
        assert_eq!(unique_ref_count("(attachments/a%20b.png) (attachments/a%20b.png) (attachments/c.png)"), 2);
    }

    #[test]
    fn encode_link_name_vectors() {
        assert_eq!(encode_link_name("a b.png"), "a%20b.png");
        assert_eq!(encode_link_name("report%20final.pdf"), "report%2520final.pdf");
        assert_eq!(encode_link_name("x(1).png"), "x(1).png");
        assert_eq!(encode_link_name("x (1).png"), "x%20(1).png");
        let n = "report%20final.pdf";
        assert!(target_matches(&encode_link_name(n), n));
    }

    #[test]
    fn orphans_keep_raw_and_decoded_refs() {
        let tmp = tempfile::TempDir::new().unwrap();
        let dir = tmp.path().join("att");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("report%20final.pdf"), "r").unwrap();
        fs::write(dir.join("a b.png"), "a").unwrap();
        fs::write(dir.join("gone.png"), "g").unwrap();
        let refs: HashSet<String> =
            refs_in_body("[r](attachments/report%20final.pdf) ![a](attachments/a%20b.png)").into_iter().collect();
        assert_eq!(cleanup_orphans(&dir, &refs, std::time::Duration::ZERO).unwrap(), 1);
        assert!(dir.join("report%20final.pdf").exists());
        assert!(dir.join("a b.png").exists());
        assert!(!dir.join("gone.png").exists());
    }

    #[test]
    fn refs_in_body_handles_balanced_parens() {
        let body = "![a](attachments/x-image (1).png)\n[b](attachments/y.pdf)";
        assert_eq!(refs_in_body(body), vec!["x-image (1).png", "y.pdf"]);
        assert!(refs_in_body("(attachments/../e)").is_empty());
        assert!(refs_in_body("(attachments/open\nnext)").is_empty());
    }

    #[test]
    fn cleanup_orphans_skips_fresh_files() {
        let tmp = tempfile::TempDir::new().unwrap();
        let dir = tmp.path().join("att");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("fresh.png"), "f").unwrap();
        let refs = HashSet::new();
        assert_eq!(cleanup_orphans(&dir, &refs, std::time::Duration::from_secs(3600)).unwrap(), 0);
        assert!(dir.join("fresh.png").exists());
    }

    #[test]
    fn save_file_renames_with_uuid_and_rejects() {
        let tmp = tempfile::TempDir::new().unwrap();
        let src = tmp.path().join("report.txt");
        fs::write(&src, "hello").unwrap();
        let bad = tmp.path().join("evil.exe");
        fs::write(&bad, "MZ").unwrap();
        let dir = tmp.path().join("att");

        let stored = save_file(&dir, &src).unwrap();
        assert!(stored.ends_with("-report.txt"));
        assert!(stored != "report.txt");
        assert!(dir.join(&stored).exists());
        assert!(save_file(&dir, &bad).is_err());

        let big = tmp.path().join("big.md");
        fs::write(&big, vec![b'x'; (MAX_FILE_BYTES + 1) as usize]).unwrap();
        assert!(save_file(&dir, &big).is_err());
    }

    #[test]
    fn save_bytes_validates_and_writes() {
        let tmp = tempfile::TempDir::new().unwrap();
        let dir = tmp.path().join("att");
        let stored = save_bytes(&dir, "voice.webm", b"abc").unwrap();
        assert!(stored.ends_with("-voice.webm"));
        assert_eq!(fs::read(dir.join(&stored)).unwrap(), b"abc");
        assert!(save_bytes(&dir, "x.exe", b"MZ").is_err());
        assert!(save_bytes(&dir, "../a.png", b"a").is_err());
        assert!(save_bytes(&dir, "a:b.png", b"a").is_err());
        assert!(save_bytes(&dir, "con.png", b"a").is_err());
        assert!(save_bytes(&dir, "big.png", &vec![0u8; (MAX_FILE_BYTES + 1) as usize]).is_err());
    }

    #[test]
    fn is_safe_name_rejects_trailing_dot_or_space() {
        for bad in ["a.png.", "a.png ", "x.", "y "] {
            assert!(!is_safe_name(bad), "{bad:?}");
        }
        assert!(is_safe_name(".hidden.png"));
    }

    #[test]
    fn unique_ref_count_by_canonical_name() {
        // Shared vector with insertLink.test.ts.
        let body = "![a](attachments/a%20b.png) ![b](attachments/a b.png) [c](attachments/c.pdf) [d](attachments/c.pdf)";
        assert_eq!(unique_ref_count(body), 2);
    }

    #[test]
    fn cleanup_orphans_in_handles_part_files_and_both_dirs() {
        let tmp = tempfile::TempDir::new().unwrap();
        let local = tmp.path().join("local");
        let remote = tmp.path().join("remote");
        for d in [&local, &remote] {
            fs::create_dir_all(d).unwrap();
            fs::write(d.join("gone.png"), "g").unwrap();
            fs::write(d.join("kept.png"), "k").unwrap();
            fs::write(d.join(".x.png.part"), "p").unwrap();
        }
        let refs: HashSet<String> = ["kept.png".to_string()].into_iter().collect();
        for d in [&local, &remote] {
            assert_eq!(cleanup_orphans_in(d, &refs, std::time::Duration::ZERO).unwrap(), 2);
            assert!(d.join("kept.png").exists());
            assert!(!d.join("gone.png").exists());
            assert!(!d.join(".x.png.part").exists());
        }
        // Nothing to resurrect after mirroring.
        crate::sync::mirror_attachments(&local, &remote).unwrap();
        assert!(!local.join("gone.png").exists());
        // Fresh remote orphans survive the grace period.
        fs::write(remote.join("new.png"), "n").unwrap();
        assert_eq!(cleanup_orphans_in(&remote, &refs, std::time::Duration::from_secs(3600)).unwrap(), 0);
        assert!(is_temp_name(".x.png.part"));
        assert!(!is_temp_name("x.png"));
    }

    #[test]
    fn is_safe_name_rules() {
        for bad in ["", "..", "a/b.png", "a\\b.png", "c:x.png", "x\u{7}.png", "CON", "nul.txt", "Lpt9.md", "aux .png", "COM1"] {
            assert!(!is_safe_name(bad), "{bad:?}");
        }
        for ok in ["console.png", "COM0.png", "COM10.png", "lpt.txt", "ảnh (1).png"] {
            assert!(is_safe_name(ok), "{ok:?}");
        }
    }

    #[test]
    fn extract_text_txt_and_binary() {
        let tmp = tempfile::TempDir::new().unwrap();
        let txt = tmp.path().join("a.txt");
        fs::write(&txt, "nội dung\n").unwrap();
        assert_eq!(extract_text(&txt).unwrap(), "nội dung\n");
        let bin = tmp.path().join("b.dat");
        fs::write(&bin, [0u8, 1, 0, 2]).unwrap();
        assert!(extract_text(&bin).is_err());
    }

    #[test]
    fn extract_docx_paragraphs() {
        let tmp = tempfile::TempDir::new().unwrap();
        let docx_path = tmp.path().join("t.docx");
        let file = fs::File::create(&docx_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options: zip::write::SimpleFileOptions = Default::default();
        zip.start_file("word/document.xml", options).unwrap();
        let xml = "<?xml?><w:document><w:p><w:t>Dòng 1</w:t></w:p><w:p><w:t>Dòng 2</w:t></w:p></w:document>";
        zip.write_all(xml.as_bytes()).unwrap();
        zip.finish().unwrap();
        let text = extract_text(&docx_path).unwrap();
        assert!(text.contains("Dòng 1"));
        assert!(text.contains("Dòng 2"));
        assert!(!text.contains("w:document"));
    }

    #[test]
    fn prepare_image_downscales_long_edge() {
        let tmp = tempfile::TempDir::new().unwrap();
        let img_path = tmp.path().join("big.png");
        // 3000x1000 red image
        let img = image::RgbaImage::from_pixel(3000, 1000, image::Rgba([255u8, 0, 0, 255]));
        img.save(&img_path).unwrap();
        let data_url = prepare_image(&img_path, MAX_IMAGE_EDGE_PX).unwrap();
        assert!(data_url.starts_with("data:image/png;base64,"));
        let b64 = data_url.split(",").nth(1).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!(decoded.width().max(decoded.height()), MAX_IMAGE_EDGE_PX);
        // small image stays untouched
        let small = tmp.path().join("small.png");
        image::RgbaImage::from_pixel(100, 60, image::Rgba([0, 255, 0, 255])).save(&small).unwrap();
        let url2 = prepare_image(&small, MAX_IMAGE_EDGE_PX).unwrap();
        let bytes2 = base64::engine::general_purpose::STANDARD.decode(url2.split(",").nth(1).unwrap()).unwrap();
        assert_eq!(image::load_from_memory(&bytes2).unwrap().width(), 100);
    }

    #[test]
    fn cleanup_orphans_removes_unreferenced_only() {
        let tmp = tempfile::TempDir::new().unwrap();
        let dir = tmp.path().join("att");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("keep.png"), "k").unwrap();
        fs::write(dir.join("orphan.png"), "o").unwrap();
        let mut refs = HashSet::new();
        refs.insert("keep.png".to_string());
        assert_eq!(cleanup_orphans(&dir, &refs, std::time::Duration::ZERO).unwrap(), 1);
        assert!(dir.join("keep.png").exists());
        assert!(!dir.join("orphan.png").exists());
        assert_eq!(cleanup_orphans(&dir, &refs, std::time::Duration::ZERO).unwrap(), 0);
    }
}
