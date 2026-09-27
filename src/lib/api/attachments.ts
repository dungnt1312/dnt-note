import { invoke } from "@tauri-apps/api/core";

export interface StoredFile {
  name: string;
  size: number;
}

export const attachmentsApi = {
  attach: (noteId: string, srcPath: string) =>
    invoke<StoredFile>("attach_file", { noteId, srcPath }),
  list: (noteId: string) => invoke<string[]>("list_attachments", { noteId }),
  extractText: (path: string) => invoke<string>("extract_attachment_text", { path }),
  prepareImage: (path: string) => invoke<string>("prepare_attachment_image", { path }),
  cleanupOrphans: () => invoke<number>("cleanup_orphan_attachments"),
};

export const syncApi = {
  getFolder: () => invoke<string | null>("get_sync_folder"),
  setFolder: (path: string | null) => invoke<void>("set_sync_folder", { path }),
};
