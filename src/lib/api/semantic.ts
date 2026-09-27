import { invoke } from "@tauri-apps/api/core";

export const semanticApi = {
  load: () => invoke<string>("load_embeddings"),
  save: (json: string) => invoke<void>("save_embeddings", { json }),
};
