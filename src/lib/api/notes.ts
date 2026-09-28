import { invoke } from "@tauri-apps/api/core";

export interface NoteMeta {
  id: string;
  title: string;
  tags: string[];
  pinned: boolean;
  folder: string | null;
  created: string;
  updated: string;
  snippet: string;
  wordCount: number;
}

export interface Note extends NoteMeta {
  body: string;
}

export interface NotePatchDto {
  title?: string;
  body?: string;
  tags?: string[];
  pinned?: boolean;
}

export interface TagCount {
  name: string;
  count: number;
}

export interface StatsDto {
  total: number;
  pinned: number;
  words: number;
  tags: number;
}

export const api = {
  notes: {
    list: () => invoke<NoteMeta[]>("list_notes"),
    read: (id: string) => invoke<Note>("read_note", { id }),
    create: (title: string, body?: string, tags?: string[]) =>
      invoke<Note>("create_note", { title, body, tags }),
    update: (id: string, patch: NotePatchDto) =>
      invoke<Note>("update_note", { id, patch }),
    del: (id: string) => invoke<void>("delete_note", { id }),
    restore: (id: string) => invoke<Note>("restore_note", { id }),
    search: (query: string, limit?: number) =>
      invoke<NoteMeta[]>("search_notes", { query, limit }),
    tags: () => invoke<TagCount[]>("list_tags"),
    emptyTrash: () => invoke<number>("empty_trash"),
    moveToFolder: (id: string, folder: string | null) =>
      invoke<Note>("move_note_to_folder", { id, folder }),
    stats: () => invoke<StatsDto>("get_stats"),
  },
  folders: {
    list: () => invoke<string[]>("list_folders"),
    create: (name: string) => invoke<string[]>("create_folder", { name }),
    rename: (oldName: string, newName: string) =>
      invoke<{ folders: string[]; moved: number }>("rename_folder", { old: oldName, new: newName }),
    del: (name: string) =>
      invoke<{ folders: string[]; moved: number }>("delete_folder", { name }),
  },
};
