export const MAX_FILES_PER_NOTE = 10;

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

/** Canonical link encoding (mirrors Rust `encode_link_name`): % -> %25, space -> %20. */
export function encodeLinkName(name: string): string {
  return name.replace(/%/g, "%25").replace(/ /g, "%20");
}

/** Markdown link for a stored attachment using the canonical encoding. */
export function markdownLinkFor(stored: string): string {
  const display = stored.replace(UUID_PREFIX, "");
  const ext = stored.split(".").pop()?.toLowerCase() ?? "";
  return `${IMAGE_EXTS.includes(ext) ? "!" : ""}[${display}](attachments/${encodeLinkName(stored)})`;
}

/** Mirrors Rust `is_safe_name`. */
export function isSafeName(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  for (const c of name) {
    if (c === "/" || c === "\\" || c === ":" || c.charCodeAt(0) < 0x20) return false;
  }
  const stem = (name.split(".")[0] ?? "").trimEnd().toUpperCase();
  return !(["CON", "PRN", "AUX", "NUL"].includes(stem) || /^(COM|LPT)[1-9]$/.test(stem));
}

/** Decode %XX escapes; null if the result is not valid UTF-8. Malformed escapes stay literal. */
export function percentDecode(s: string): string | null {
  const bytes: number[] = [];
  const raw = new TextEncoder().encode(s);
  for (let i = 0; i < raw.length; i++) {
    const hex = String.fromCharCode(raw[i + 1] ?? 0, raw[i + 2] ?? 0);
    if (raw[i] === 0x25 && i + 2 < raw.length && /^[0-9a-fA-F]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else bytes.push(raw[i]);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

/** Raw `(attachments/...)` targets with balanced parens; mirrors Rust `link_targets`. */
export function linkTargets(body: string): string[] {
  const MARK = "(attachments/";
  const out: string[] = [];
  let i = body.indexOf(MARK);
  while (i !== -1) {
    const start = i + MARK.length;
    let depth = 1;
    let end = -1;
    for (let j = start; j < body.length; j++) {
      const ch = body[j];
      if (ch === "(") depth++;
      else if (ch === ")") {
        if (--depth === 0) {
          end = j;
          break;
        }
      } else if (ch === "\n") break;
    }
    if (end === -1) {
      i = body.indexOf(MARK, start);
      continue;
    }
    out.push(body.slice(start, end).trim());
    i = body.indexOf(MARK, end + 1);
  }
  return out;
}

/** Safe names a raw target may refer to (raw and decoded forms). */
export function targetCandidates(raw: string): string[] {
  const out: string[] = [];
  if (isSafeName(raw)) out.push(raw);
  const d = percentDecode(raw);
  if (d !== null && d !== raw && isSafeName(d)) out.push(d);
  return out;
}

/** Distinct attachment link targets (by raw text); mirrors Rust `unique_ref_count`. */
export function countAttachmentRefs(body: string): number {
  return new Set(linkTargets(body).filter((t) => targetCandidates(t).length > 0)).size;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export async function fileToBase64(file: File): Promise<string> {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
}
