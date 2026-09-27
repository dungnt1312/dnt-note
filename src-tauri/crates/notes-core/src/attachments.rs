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
];

pub fn is_allowed(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| ALLOWED_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Names referenced as `(attachments/<name>)` in a note body.
/// Parens inside the name must be balanced (e.g. `image (1).png`); a link
/// that hits a newline before closing is ignored.
pub fn refs_in_body(body: &str) -> Vec<String> {
    const MARK: &str = "(attachments/";
    let mut out = Vec::new();
    let mut rest = body;
    while let Some(pos) = rest.find(MARK) {
        rest = &rest[pos + MARK.len()..];
        let mut depth = 1usize;
        let mut end = None;
        for (i, ch) in rest.char_indices() {
            match ch {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(i);
                        break;
                    }
                }
                '\n' => break,
                _ => {}
            }
        }
        let Some(end) = end else { continue };
        let name = rest[..end].trim();
        if !name.is_empty() && !name.contains('/') && !name.contains('\\') {
            out.push(name.to_string());
        }
        rest = &rest[end + 1..];
    }
    out
}

/// Copy a file into the attachments dir as `<uuid>-<original name>`.
pub fn save_file(attachments_dir: &Path, src: &Path) -> Result<String> {
    if !is_allowed(src) {
        return Err(NoteError::Unknown(format!(
            "Định dạng không hỗ trợ: {}",
            src.extension().and_then(|e| e.to_str()).unwrap_or("?")
        )));
    }
    let size = fs::metadata(src)?.len();
    if size > MAX_FILE_BYTES {
        return Err(NoteError::Unknown(format!(
            "File quá lớn ({:.1}MB, giới hạn 25MB)",
            size as f64 / (1024.0 * 1024.0)
        )));
    }
    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| NoteError::Unknown("Tên file không hợp lệ".into()))?;
    let stored = format!("{}-{}", uuid::Uuid::new_v4(), file_name);
    fs::create_dir_all(attachments_dir)?;
    fs::copy(src, attachments_dir.join(&stored))?;
    Ok(stored)
}

/// Write raw bytes into the attachments dir as `<uuid>-<file_name>` (paste/drop path).
pub fn save_bytes(attachments_dir: &Path, file_name: &str, bytes: &[u8]) -> Result<String> {
    let clean = Path::new(file_name);
    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || clean.file_name().and_then(|n| n.to_str()) != Some(file_name)
    {
        return Err(NoteError::Unknown("Tên file không hợp lệ".into()));
    }
    if !is_allowed(clean) {
        return Err(NoteError::Unknown(format!(
            "Định dạng không hỗ trợ: {}",
            clean.extension().and_then(|e| e.to_str()).unwrap_or("?")
        )));
    }
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(NoteError::Unknown(format!(
            "File quá lớn ({:.1}MB, giới hạn 25MB)",
            bytes.len() as f64 / (1024.0 * 1024.0)
        )));
    }
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
    let mut removed = 0;
    if !attachments_dir.exists() {
        return Ok(0);
    }
    for entry in fs::read_dir(attachments_dir)?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        if referenced.contains(&name) {
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

    #[test]
    fn save_bytes_round_trip_and_name() {
        let tmp = tempfile::TempDir::new().unwrap();
        let dir = tmp.path().join("att");
        let stored = save_bytes(&dir, "slide deck.pdf", b"pdf-bytes").unwrap();
        assert!(stored.ends_with("-slide deck.pdf"));
        assert_eq!(fs::read(dir.join(&stored)).unwrap(), b"pdf-bytes");
    }

    #[test]
    fn save_bytes_rejects_bad_input() {
        let dir = std::env::temp_dir();
        assert!(save_bytes(&dir, "virus.exe", b"x").is_err()); // extension allowlist
        assert!(save_bytes(&dir, "../escape.png", b"x").is_err()); // no path separators
        assert!(save_bytes(&dir, "", b"x").is_err()); // empty name
        let big = vec![0u8; (MAX_FILE_BYTES + 1) as usize];
        assert!(save_bytes(&dir, "big.png", &big).is_err()); // size cap
    }
}
