import { invoke } from "@tauri-apps/api/core";

export interface NoteMeta {
  id: string;
  title: string;
  tags: string[];
  pinned: boolean;
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
    stats: () => invoke<StatsDto>("get_stats"),
  },
};
