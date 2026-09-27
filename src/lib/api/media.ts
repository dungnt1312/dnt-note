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
  import: (srcPath: string) => invoke<string>("import_media", { srcPath }),
  dirPath: () => invoke<string>("attachments_dir_path"),
};
