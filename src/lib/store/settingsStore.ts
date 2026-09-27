import { create } from "zustand";

export interface LlmProvider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  embeddingModel?: string;
  transcriptionModel?: string;
}

interface SettingsState {
  providers: LlmProvider[];
  activeProviderId: string | null;
  /** User consent: send note content to the embeddings endpoint. */
  semanticIndexing: boolean;
  setSemanticIndexing: (on: boolean) => Promise<void>;
  loaded: boolean;
  loadStore: () => Promise<void>;
  addProvider: (p: Omit<LlmProvider, "id">) => Promise<void>;
  upsertProvider: (id: string, patch: Partial<Omit<LlmProvider, "id">>) => Promise<void>;
  removeProvider: (id: string) => Promise<void>;
  setActiveProvider: (id: string | null) => void;
  activeProvider: () => LlmProvider | null;
}

export const PROVIDER_PRESETS: { name: string; baseUrl: string; model: string }[] = [
  { name: "Ollama (local)", baseUrl: "http://localhost:11434", model: "llama3.1" },
  { name: "OpenAI", baseUrl: "https://api.openai.com", model: "gpt-4o-mini" },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api", model: "openai/gpt-4o-mini" },
  { name: "Groq", baseUrl: "https://api.groq.com/openai", model: "llama-3.3-70b-versatile" },
  { name: "vLLM", baseUrl: "http://localhost:8000", model: "model" },
];

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type StoreApi = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  save: () => Promise<void>;
};

let storeApi: StoreApi | null = null;

async function getStore(): Promise<StoreApi | null> {
  if (!isTauri) {
    // Browser dev fallback: keep config in localStorage so UI is usable.
    if (!storeApi) {
      storeApi = {
        get: async (k) => {
          const raw = localStorage.getItem(`dnt-store:${k}`);
          return raw ? JSON.parse(raw) : undefined;
        },
        set: async (k, v) => {
          localStorage.setItem(`dnt-store:${k}`, JSON.stringify(v));
        },
        save: async () => {},
      };
    }
    return storeApi;
  }
  if (!storeApi) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load("providers.json", { autoSave: true });
    storeApi = {
      get: (k) => store.get(k),
      set: (k, v) => store.set(k, v),
      save: () => store.save(),
    };
  }
  return storeApi;
}

function newId(): string {
  return `p_${Math.random().toString(36).slice(2, 10)}`;
}

async function persist(state: SettingsState): Promise<void> {
  const store = await getStore();
  if (!store) return;
  await store.set("providers", state.providers);
  await store.set("activeProviderId", state.activeProviderId);
  await store.set("semanticIndexing", state.semanticIndexing);
  await store.save();
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  providers: [],
  activeProviderId: null,
  semanticIndexing: false,
  loaded: false,

  loadStore: async () => {
    try {
      const store = await getStore();
      const providers = ((await store?.get("providers")) as LlmProvider[] | undefined) ?? [];
      const activeProviderId =
        ((await store?.get("activeProviderId")) as string | undefined) ?? null;
      set({ semanticIndexing: (await store?.get("semanticIndexing")) === true });
      if (providers.length === 0) {
        // First run: seed the local Ollama preset so chat works out of the box.
        const first: LlmProvider = { id: newId(), ...PROVIDER_PRESETS[0], apiKey: "" };
        set({ providers: [first], activeProviderId: first.id, loaded: true });
        await persist(get());
      } else {
        set({ providers, activeProviderId, loaded: true });
      }
    } catch (e) {
      console.error("settings load failed", e);
      set({ loaded: true });
    }
  },

  addProvider: async (p) => {
    set((s) => {
      const provider = { ...p, id: newId() };
      return {
        providers: [...s.providers, provider],
        activeProviderId: s.activeProviderId ?? provider.id,
      };
    });
    await persist(get());
  },

  upsertProvider: async (id, patch) => {
    set((s) => ({
      providers: s.providers.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    }));
    await persist(get());
  },

  removeProvider: async (id) => {
    set((s) => ({
      providers: s.providers.filter((x) => x.id !== id),
      activeProviderId: s.activeProviderId === id ? null : s.activeProviderId,
    }));
    await persist(get());
  },

  setSemanticIndexing: async (on) => {
    set({ semanticIndexing: on });
    await persist(get());
  },

  setActiveProvider: (id) => set({ activeProviderId: id }),

  activeProvider: () => {
    const { providers, activeProviderId } = get();
    return providers.find((p) => p.id === activeProviderId) ?? providers[0] ?? null;
  },
}));
