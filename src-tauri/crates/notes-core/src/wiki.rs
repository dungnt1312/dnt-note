//! Wiki-link (`[[Target]]` / `[[Target|alias]]`) parsing.

/// Targets of all wiki-links in `body`, trimmed, in order. Skips fenced
/// blocks (CommonMark: indent <= 3, ``` or ~~~) and single-line inline code.
/// Mirrors `parseWikiLinks` in src/lib/editor/wikiLinks.ts (shared vectors).
pub fn parse_wiki_targets(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut fence: Option<(u8, usize)> = None;
    for line in body.split('\n') {
        if let Some(f) = fence {
            if closes_fence(line, f) {
                fence = None;
            }
        } else if let Some(f) = fence_open(line) {
            fence = Some(f);
        } else {
            scan_line(line, &mut out);
        }
    }
    out
}

fn fence_run(line: &str, allow_trailing: bool) -> Option<(u8, usize)> {
    let b = line.as_bytes();
    let indent = b.iter().take_while(|&&c| c == b' ').count();
    if indent > 3 {
        return None;
    }
    let c = *b.get(indent)?;
    if c != b'`' && c != b'~' {
        return None;
    }
    let run = b[indent..].iter().take_while(|&&x| x == c).count();
    if !allow_trailing && !line[indent + run..].trim().is_empty() {
        return None;
    }
    Some((c, run))
}

fn fence_open(line: &str) -> Option<(u8, usize)> {
    fence_run(line, true).filter(|&(_, n)| n >= 3)
}

fn closes_fence(line: &str, (c, n): (u8, usize)) -> bool {
    matches!(fence_run(line, false), Some((c2, n2)) if c2 == c && n2 >= n)
}

fn scan_line(line: &str, out: &mut Vec<String>) {
    let b = line.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'`' {
            let run = b[i..].iter().take_while(|&&c| c == b'`').count();
            // Closing run of exactly the same length on this line.
            let mut j = i + run;
            let mut closed = None;
            while j < b.len() {
                if b[j] != b'`' {
                    j += 1;
                    continue;
                }
                let r = b[j..].iter().take_while(|&&c| c == b'`').count();
                if r == run {
                    closed = Some(j + r);
                    break;
                }
                j += r;
            }
            i = closed.unwrap_or(i + run);
            continue;
        }
        if b[i] == b'[' && b.get(i + 1) == Some(&b'[') {
            if let Some(close) = line[i + 2..].find("]]") {
                let inner = &line[i + 2..i + 2 + close];
                if !inner.contains('[') && !inner.contains(']') {
                    let target = inner.split('|').next().unwrap_or("").trim();
                    if !target.is_empty() {
                        out.push(target.to_string());
                        i += 2 + close + 2;
                        continue;
                    }
                }
            }
        }
        i += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_vectors() {
        let raw = include_str!("../tests/wiki_vectors.json");
        let cases: Vec<serde_json::Value> = serde_json::from_str(raw).unwrap();
        assert!(!cases.is_empty());
        for c in cases {
            let input = c["input"].as_str().unwrap();
            let want: Vec<String> = c["targets"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect();
            assert_eq!(parse_wiki_targets(input), want, "input: {input:?}");
        }
    }
}
