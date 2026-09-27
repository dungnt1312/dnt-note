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
  /** Edit origin; "agent"/"mcp" force a history snapshot. */
  source?: "agent" | "mcp";
}

export interface VersionMeta {
  version: string;
  created: string;
  title: string;
  words: number;
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
    snapshot: (id: string) => invoke<string | null>("snapshot_note", { id }),
    listVersions: (id: string) => invoke<VersionMeta[]>("list_versions", { id }),
    readVersion: (id: string, version: string) => invoke<Note>("read_version", { id, version }),
    restoreVersion: (id: string, version: string) =>
      invoke<Note>("restore_version", { id, version }),
    del: (id: string) => invoke<void>("delete_note", { id }),
    restore: (id: string) => invoke<Note>("restore_note", { id }),
    search: (query: string, limit?: number) =>
      invoke<NoteMeta[]>("search_notes", { query, limit }),
    backlinks: (id: string) => invoke<NoteMeta[]>("get_backlinks", { id }),
    tags: () => invoke<TagCount[]>("list_tags"),
    emptyTrash: () => invoke<number>("empty_trash"),
    stats: () => invoke<StatsDto>("get_stats"),
  },
};
