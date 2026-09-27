import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { defaultUrlTransform } from "react-markdown";
import { isTauri } from "../env";

let attachmentsDir: string | null = null;
let pending: Promise<void> | null = null;
const readyListeners = new Set<() => void>();

/** Subscribe to the attachments dir becoming available. Returns an unsubscribe fn. */
export function onAttachmentsDirReady(cb: () => void): () => void {
  readyListeners.add(cb);
  return () => readyListeners.delete(cb);
}

/** Resolve `<appDataDir>/attachments` once. No-op outside Tauri. */
export function initAttachmentsDir(): Promise<void> {
  if (!isTauri) return Promise.resolve();
  if (!pending) {
    pending = appDataDir()
      .then((base) => join(base, "attachments"))
      .then((dir) => {
        attachmentsDir = dir;
        for (const cb of readyListeners) cb();
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
  const m = /^(?:\.\/)?attachments\/(.+)$/.exec(url);
  if (!m) return url;
  let name = m[1];
  try {
    name = decodeURIComponent(name);
  } catch {
    return url;
  }
  // Names are flat file names; anything that could escape the dir is left to default handling.
  if (["/", "\\", "\0", ".."].some((bad) => name.includes(bad))) return url;
  return attachmentUrl(name) || url;
}

/** react-markdown `urlTransform`: asset URL for attachments, default sanitising otherwise. */
export function markdownUrlTransform(url: string): string {
  const rewritten = rewriteAttachmentSrc(url);
  return rewritten !== url ? rewritten : defaultUrlTransform(url);
}
