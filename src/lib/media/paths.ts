/** Max characters of extracted document text sent to the model. */
export const MAX_DOC_CHARS = 20000;

/** Join the attachments dir and a flat stored file name using the dir's separator. */
export function joinAttachmentPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}
