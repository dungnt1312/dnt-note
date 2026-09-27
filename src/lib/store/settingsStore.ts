import { create } from "zustand";
import { cleanModelList } from "../llm/models";

export interface LlmProvider {
  id: string;
  name: string;
  baseUrl: string;
  /** Model used for chat — one of `models`, or "" when none is saved. */
  model: string;
  /** Models saved for this provider; the chat header offers all of them. */
  models: string[];
  apiKey: string;
}

/** Providers saved before multi-model support have no `models`. */
type StoredProvider = Omit<LlmProvider, "models"> & { models?: unknown };

interface SettingsState {
  providers: LlmProvider[];
  activeProviderId: string | null;
  loaded: boolean;
  loadStore: () => Promise<void>;
  addProvider: (p: Omit<LlmProvider, "id" | "models"> & { models?: string[] }) => Promise<void>;
  upsertProvider: (id: string, patch: Partial<Pick<LlmProvider, "name" | "baseUrl" | "apiKey">>) => Promise<void>;
  /** Replace the saved models; if the current model was dropped, the first one takes over. */
  setModels: (id: string, models: string[]) => Promise<void>;
  /** Chat with `model` of provider `id` (the provider becomes active). */
  selectModel: (id: string, model: string) => Promise<void>;
  removeProvider: (id: string) => Promise<void>;
  setActiveProvider: (id: string | null) => Promise<void>;
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

function withModels(p: StoredProvider): LlmProvider {
  const saved = Array.isArray(p.models) ? p.models : [p.model];
  const models = cleanModelList(saved.filter((m): m is string => typeof m === "string"));
  return { ...p, models, model: models.includes(p.model) ? p.model : (models[0] ?? "") };
}

async function persist(state: SettingsState): Promise<void> {
  const store = await getStore();
  if (!store) return;
  await store.set("providers", state.providers);
  await store.set("activeProviderId", state.activeProviderId);
  await store.save();
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  providers: [],
  activeProviderId: null,
  loaded: false,

  loadStore: async () => {
    try {
      const store = await getStore();
      const stored = ((await store?.get("providers")) as StoredProvider[] | undefined) ?? [];
      const providers = stored.map(withModels);
      const activeProviderId =
        ((await store?.get("activeProviderId")) as string | undefined) ?? null;
      if (providers.length === 0) {
        // First run: seed the local Ollama preset so chat works out of the box.
        const first = withModels({ id: newId(), ...PROVIDER_PRESETS[0], apiKey: "" });
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
      const provider = withModels({ ...p, id: newId() });
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

  setModels: async (id, models) => {
    const list = cleanModelList(models);
    set((s) => ({
      providers: s.providers.map((x) =>
        x.id === id ? { ...x, models: list, model: list.includes(x.model) ? x.model : (list[0] ?? "") } : x,
      ),
    }));
    await persist(get());
  },

  selectModel: async (id, model) => {
    set((s) => ({
      activeProviderId: id,
      providers: s.providers.map((x) => (x.id === id ? { ...x, model } : x)),
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

  setActiveProvider: async (id) => {
    set({ activeProviderId: id });
    await persist(get());
  },

  activeProvider: () => {
    const { providers, activeProviderId } = get();
    return providers.find((p) => p.id === activeProviderId) ?? providers[0] ?? null;
  },
}));
