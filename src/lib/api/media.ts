import { invoke } from "@tauri-apps/api/core";

export type MediaKind = "image" | "document" | "audio" | "other";

export interface MediaItem {
  name: string;
  displayName: string;
  ext: string;
  kind: MediaKind;
  size: number;
  modified: string;
  usedBy: { id: string; title: string }[];
}

export const mediaApi = {
  list: () => invoke<MediaItem[]>("list_media"),
  rename: (name: string, newName: string) => invoke<string>("rename_media", { name, newName }),
  del: (name: string, force: boolean) => invoke<void>("delete_media", { name, force }),
  import: (srcPath: string) => invoke<{ name: string; size: number }>("import_media", { srcPath }),
  attachBytes: (noteId: string, fileName: string, base64: string) =>
    invoke<{ name: string; size: number }>("attach_bytes", { noteId, fileName, base64 }),
  importBytes: (fileName: string, base64: string) =>
    invoke<{ name: string; size: number }>("import_media_bytes", { fileName, base64 }),
  dirPath: () => invoke<string>("attachments_dir_path"),
};
