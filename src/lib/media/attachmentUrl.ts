import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { defaultUrlTransform } from "react-markdown";
import { isTauri } from "../env";

let attachmentsDir: string | null = null;
let pending: Promise<void> | null = null;

/** Resolve `<appDataDir>/attachments` once. No-op outside Tauri. */
export function initAttachmentsDir(): Promise<void> {
  if (!isTauri) return Promise.resolve();
  if (!pending) {
    pending = appDataDir()
      .then((base) => join(base, "attachments"))
      .then((dir) => {
        attachmentsDir = dir;
      })
      .catch(() => {
        pending = null;
      });
  }
  return pending;
}

/** Test hook: set (or clear) the resolved attachments directory. */
export function setAttachmentsDirForTest(dir: string | null): void {
  attachmentsDir = dir;
}

/** Asset-protocol URL for an attachment file name, or "" when unavailable. */
export function attachmentUrl(name: string): string {
  if (!attachmentsDir || !name) return "";
  const sep = attachmentsDir.includes("\\") ? "\\" : "/";
  // convertFileSrc percent-encodes the whole path, so pass the raw name.
  return convertFileSrc(`${attachmentsDir}${sep}${name}`);
}

/** Map `attachments/<name>` to its asset URL; other URLs are returned unchanged. */
export function rewriteAttachmentSrc(url: string): string {
  const m = /^\.?\/?attachments\/(.+)$/.exec(url);
  if (!m) return url;
  let name = m[1];
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep raw name when it is not valid percent-encoding
  }
  return attachmentUrl(name) || url;
}

/** react-markdown `urlTransform`: asset URL for attachments, default sanitising otherwise. */
export function markdownUrlTransform(url: string): string {
  const rewritten = rewriteAttachmentSrc(url);
  return rewritten !== url ? rewritten : defaultUrlTransform(url);
}
