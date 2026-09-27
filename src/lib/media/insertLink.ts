export const MAX_FILES_PER_NOTE = 10;

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

/** Markdown link for a stored attachment; spaces are %20-encoded (CommonMark-safe). */
export function markdownLinkFor(stored: string): string {
  const display = stored.replace(UUID_PREFIX, "");
  const ext = stored.split(".").pop()?.toLowerCase() ?? "";
  const dest = `attachments/${stored.replace(/ /g, "%20")}`;
  return `${IMAGE_EXTS.includes(ext) ? "!" : ""}[${display}](${dest})`;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Unique attachment refs in a body; mirrors Rust `refs_in_body`. */
export function countAttachmentRefs(body: string): number {
  const MARK = "(attachments/";
  const refs = new Set<string>();
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
    const name = decode(body.slice(start, end).trim());
    if (name && !name.includes("/") && !name.includes("\\")) refs.add(name);
    i = body.indexOf(MARK, end + 1);
  }
  return refs.size;
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
