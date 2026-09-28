import { invoke } from "@tauri-apps/api/core";

export interface StoredFile {
  name: string;
  size: number;
  /** Absolute path of the stored file. */
  path: string;
}

export const attachmentsApi = {
  attach: (noteId: string, srcPath: string) =>
    invoke<StoredFile>("attach_file", { noteId, srcPath }),
  /** Copy an external file into attachments/ without touching any note. */
  importFile: (srcPath: string) => invoke<StoredFile>("import_attachment", { srcPath }),
  /** Import raw bytes (paste/drop File) into attachments/. */
  importBytes: (fileName: string, bytes: Uint8Array) =>
    invoke<StoredFile>("import_attachment_bytes", { fileName, bytes: Array.from(bytes) }),
  list: (noteId: string) => invoke<string[]>("list_attachments", { noteId }),
  /** Accepts an absolute path or a bare stored name (resolved server-side). */
  extractText: (path: string) => invoke<string>("extract_attachment_text", { path }),
  prepareImage: (path: string) => invoke<string>("prepare_attachment_image", { path }),
  cleanupOrphans: () => invoke<number>("cleanup_orphan_attachments"),
};

export const syncApi = {
  getFolder: () => invoke<string | null>("get_sync_folder"),
  setFolder: (path: string | null) => invoke<void>("set_sync_folder", { path }),
};
