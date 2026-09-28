import { create } from "zustand";
import { secretsApi } from "../api/secrets";
import { useUi } from "./uiStore";
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
  embeddingModel?: string;
  transcriptionModel?: string;
  /** Persisted flag: the real apiKey lives in the OS credential vault. */
  keyInVault?: boolean;
  /** In-memory only: vault read errored, so the vault state is unknown. */
  vaultReadFailed?: boolean;
}

/** Providers saved before multi-model support have no `models`. */
type StoredProvider = Omit<LlmProvider, "models"> & { models?: unknown };

interface SettingsState {
  providers: LlmProvider[];
  activeProviderId: string | null;
  /** User consent: send note content to the embeddings endpoint. */
  semanticIndexing: boolean;
  setSemanticIndexing: (on: boolean) => Promise<void>;
  loaded: boolean;
  loadStore: () => Promise<void>;
  addProvider: (p: Omit<LlmProvider, "id" | "models"> & { models?: string[] }) => Promise<void>;
  upsertProvider: (
    id: string,
    patch: Partial<Pick<LlmProvider, "name" | "baseUrl" | "apiKey" | "model" | "embeddingModel" | "transcriptionModel">>,
  ) => Promise<void>;
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
  vaultWarned = false;
}

const secretKey = (id: string) => `provider:${id}`;
let vaultWarned = false;

function warnVaultOnce(): void {
  if (vaultWarned) return;
  vaultWarned = true;
  useUi.getState().pushToast({
    message: "Không dùng được kho khóa của hệ thống — khóa API vẫn lưu trong providers.json",
    durationMs: 8000,
  });
}

/** Moves API keys into the OS vault; returns provider objects safe to write to disk. */
async function toPersisted(providers: LlmProvider[]): Promise<LlmProvider[]> {
  const strip = ({ vaultReadFailed: _f, ...rest }: LlmProvider): LlmProvider => rest;
  if (!isTauri()) return providers.map(strip);
  return Promise.all(
    providers.map(async (full) => {
      const p = strip(full);
      // Unknown vault state: never touch the secret or the flag.
      if (full.vaultReadFailed) return { ...p, apiKey: "", keyInVault: true };
      if (p.apiKey) {
        try {
          await secretsApi.set(secretKey(p.id), p.apiKey);
          return { ...p, apiKey: "", keyInVault: true };
        } catch (e) {
          console.warn("vault set failed", e);
          warnVaultOnce();
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

let persistChain: Promise<void> = Promise.resolve();
let persistQueued: Promise<void> | null = null;

function withModels(p: StoredProvider): LlmProvider {
  const saved = Array.isArray(p.models) ? p.models : [p.model];
  const models = cleanModelList(saved.filter((m): m is string => typeof m === "string"));
  return { ...p, models, model: models.includes(p.model) ? p.model : (models[0] ?? "") };
}

/** Serialized persist: runs after the previous one, always with the latest state; coalesces queued calls. */
function persist(_state?: SettingsState): Promise<void> {
  if (persistQueued) return persistQueued;
  const run = persistChain
    .catch(() => {})
    .then(() => {
      persistQueued = null;
      return persistNow(useSettingsStore.getState());
    });
  persistQueued = run;
  persistChain = run;
  return run;
}

async function persistNow(state: SettingsState): Promise<void> {
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
      const stored = ((await store?.get("providers")) as StoredProvider[] | undefined) ?? [];
      const providers = stored.map(withModels);
      const activeProviderId =
        ((await store?.get("activeProviderId")) as string | undefined) ?? null;
      set({ semanticIndexing: (await store?.get("semanticIndexing")) === true });
      if (providers.length === 0) {
        // First run: seed the local Ollama preset so chat works out of the box.
        const first = withModels({ id: newId(), ...PROVIDER_PRESETS[0], apiKey: "" });
        set({ providers: [first], activeProviderId: first.id, loaded: true });
        await persist();
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
                    warnVaultOnce();
                    return { ...p, apiKey: "", vaultReadFailed: true };
                  }
                }
                if (p.apiKey) migrate = true;
                return p;
              }),
            )
          : providers;
        set({ providers: loadedProviders, activeProviderId, loaded: true });
        if (migrate) await persist();
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
    await persist();
  },

  upsertProvider: async (id, patch) => {
    set((s) => ({
      providers: s.providers.map((x) => {
        if (x.id !== id) return x;
        const next = { ...x, ...patch };
        if ("apiKey" in patch) delete next.vaultReadFailed;
        return next;
      }),
    }));
    await persist();
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
    await persist();
  },

  setSemanticIndexing: async (on) => {
    set({ semanticIndexing: on });
    await persist();
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
