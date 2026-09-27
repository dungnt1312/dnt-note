//! Wiki-link (`[[Target]]` / `[[Target|alias]]`) parsing.

/// Targets of all wiki-links in `body`, trimmed, in order. Links inside
/// fenced code blocks or inline code spans are ignored.
pub fn parse_wiki_targets(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_fence: Option<&str> = None;
    for line in body.split('\n') {
        let t = line.trim_start();
        if let Some(f) = in_fence {
            if t.starts_with(f) {
                in_fence = None;
            }
            continue;
        }
        if t.starts_with("```") {
            in_fence = Some("```");
            continue;
        }
        if t.starts_with("~~~") {
            in_fence = Some("~~~");
            continue;
        }
        scan_line(line, &mut out);
    }
    out
}

fn scan_line(line: &str, out: &mut Vec<String>) {
    let b = line.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'`' {
            // Skip an inline code span delimited by the same backtick run.
            let run = b[i..].iter().take_while(|&&c| c == b'`').count();
            let delim = &line[i..i + run];
            if let Some(end) = line[i + run..].find(delim) {
                i += run + end + run;
            } else {
                i += run;
            }
            continue;
        }
        if b[i] == b'[' && b.get(i + 1) == Some(&b'[') {
            let rest = &line[i + 2..];
            if let Some(close) = rest.find("]]") {
                let inner = &rest[..close];
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
    fn parses_plain_and_alias() {
        assert_eq!(
            parse_wiki_targets("a [[Ghi chú]] b [[ Kế hoạch | plan ]]"),
            vec!["Ghi chú", "Kế hoạch"]
        );
    }

    #[test]
    fn rejects_empty_nested_multiline() {
        assert_eq!(parse_wiki_targets("[[]] [[ ]] [[a\nb]] [[a[[b]]"), vec!["b"]);
    }

    #[test]
    fn ignores_code() {
        let body = "`[[A]]` x\n```\n[[B]]\n```\n[[C]]";
        assert_eq!(parse_wiki_targets(body), vec!["C"]);
    }
}
