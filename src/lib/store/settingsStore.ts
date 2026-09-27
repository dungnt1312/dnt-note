import { create } from "zustand";
import { secretsApi } from "../api/secrets";
import { useUi } from "./uiStore";

export interface LlmProvider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  embeddingModel?: string;
  transcriptionModel?: string;
  /** Persisted flag: the real apiKey lives in the OS credential vault. */
  keyInVault?: boolean;
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

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type StoreApi = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  save: () => Promise<void>;
};

let storeApi: StoreApi | null = null;

async function getStore(): Promise<StoreApi | null> {
  if (!isTauri()) {
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

/** Test hook: drop cached store handle. */
export function __resetStoreCache(): void {
  storeApi = null;
}

const secretKey = (id: string) => `provider:${id}`;
let vaultWarned = false;

/** Moves API keys into the OS vault; returns provider objects safe to write to disk. */
async function toPersisted(providers: LlmProvider[]): Promise<LlmProvider[]> {
  if (!isTauri()) return providers;
  return Promise.all(
    providers.map(async (p) => {
      if (p.apiKey) {
        try {
          await secretsApi.set(secretKey(p.id), p.apiKey);
          return { ...p, apiKey: "", keyInVault: true };
        } catch (e) {
          console.warn("vault set failed", e);
          if (!vaultWarned) {
            vaultWarned = true;
            useUi.getState().pushToast({
              message: "Không dùng được kho khóa của hệ thống — khóa API vẫn lưu trong providers.json",
              durationMs: 8000,
            });
          }
          return { ...p, keyInVault: false };
        }
      }
      if (p.keyInVault) {
        try {
          await secretsApi.delete(secretKey(p.id));
        } catch (e) {
          console.warn("vault delete failed", e);
        }
      }
      return { ...p, apiKey: "", keyInVault: false };
    }),
  );
}

async function persist(state: SettingsState): Promise<void> {
  const store = await getStore();
  if (!store) return;
  const persisted = await toPersisted(state.providers);
  // Keep the in-memory flag in sync without touching the real keys.
  const flags = new Map(persisted.map((p) => [p.id, p.keyInVault]));
  useSettingsStore.setState((s) => ({
    providers: s.providers.map((p) => (flags.has(p.id) ? { ...p, keyInVault: flags.get(p.id) } : p)),
  }));
  await store.set("providers", persisted);
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
        let migrate = false;
        const loadedProviders = isTauri()
          ? await Promise.all(
              providers.map(async (p) => {
                if (p.keyInVault) {
                  try {
                    return { ...p, apiKey: (await secretsApi.get(secretKey(p.id))) ?? "" };
                  } catch (e) {
                    console.warn("vault get failed", e);
                    return { ...p, apiKey: "" };
                  }
                }
                if (p.apiKey) migrate = true;
                return p;
              }),
            )
          : providers;
        set({ providers: loadedProviders, activeProviderId, loaded: true });
        if (migrate) await persist(get());
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
    if (isTauri()) {
      try {
        await secretsApi.delete(secretKey(id));
      } catch (e) {
        console.warn("vault delete failed", e);
      }
    }
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
