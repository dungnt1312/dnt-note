import { invoke } from "@tauri-apps/api/core";

export interface ChatMessageDto {
  role: string;
  content: string | null;
  toolCalls?: unknown;
  toolCallId?: string;
  name?: string;
}

export interface ChatSessionDto {
  id: string;
  title: string;
  messages: ChatMessageDto[];
  updated: string;
}

export interface ChatMetaDto {
  id: string;
  title: string;
  updated: string;
}

export const api = {
  chats: {
    list: () => invoke<ChatMetaDto[]>("list_chats"),
    load: (id: string) => invoke<ChatSessionDto>("load_chat", { id }),
    save: (session: ChatSessionDto) => invoke<void>("save_chat", { session }),
    del: (id: string) => invoke<void>("delete_chat", { id }),
  },
};
