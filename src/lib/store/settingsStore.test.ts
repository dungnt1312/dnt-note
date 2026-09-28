import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => {
    throw new Error("not in tauri");
  }),
}));

import { useSettingsStore } from "./settingsStore";

describe("settingsStore providers (localStorage fallback)", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      providers: [],
      activeProviderId: null,
      loaded: false,
    });
  });

  it("loadStore initializes an Ollama default on first run", async () => {
    await useSettingsStore.getState().loadStore();
    const s = useSettingsStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.providers).toHaveLength(1);
    expect(s.providers[0].baseUrl).toContain("localhost");
    expect(s.activeProviderId).toBe(s.providers[0].id);
  });

  it("addProvider persists to localStorage; upsertProvider updates", async () => {
    await useSettingsStore.getState().loadStore();
    await useSettingsStore.getState().addProvider({
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api",
      model: "openai/gpt-4o-mini",
      apiKey: "sk-test",
    });
    const s = useSettingsStore.getState();
    expect(s.providers).toHaveLength(2);

    const persisted = JSON.parse(localStorage.getItem("dnt-store:providers") ?? "[]");
    expect(persisted).toHaveLength(2);

    const id = s.providers[1].id;
    await useSettingsStore.getState().upsertProvider(id, { baseUrl: "https://openrouter.ai/api/v1" });
    expect(useSettingsStore.getState().providers[1].baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("removeProvider and setActive work", async () => {
    await useSettingsStore.getState().loadStore();
    await useSettingsStore.getState().addProvider({
      name: "P2", baseUrl: "http://x", model: "m", apiKey: "",
    });
    const id = useSettingsStore.getState().providers[1].id;
    useSettingsStore.getState().setActiveProvider(id);
    expect(useSettingsStore.getState().activeProviderId).toBe(id);
    await useSettingsStore.getState().removeProvider(id);
    expect(useSettingsStore.getState().providers).toHaveLength(1);
    expect(useSettingsStore.getState().activeProviderId).toBeNull();
  });

  it("activeProvider falls back to first provider", async () => {
    await useSettingsStore.getState().loadStore();
    expect(useSettingsStore.getState().activeProvider()).toBeTruthy();
    useSettingsStore.getState().setActiveProvider(null);
    expect(useSettingsStore.getState().activeProvider()).toBeTruthy();
  });

  it("second loadStore restores persisted providers", async () => {
    await useSettingsStore.getState().loadStore();
    await useSettingsStore.getState().addProvider({
      name: "Keep", baseUrl: "http://k", model: "km", apiKey: "",
    });
    useSettingsStore.setState({ providers: [], activeProviderId: null, loaded: false });
    await useSettingsStore.getState().loadStore();
    expect(useSettingsStore.getState().providers).toHaveLength(2);
  });
});

describe("settingsStore models per provider", () => {
  const reload = async () => {
    useSettingsStore.setState({ providers: [], activeProviderId: null, loaded: false });
    await useSettingsStore.getState().loadStore();
  };

  beforeEach(async () => {
    localStorage.clear();
    await reload();
  });

  it("providers saved before multi-model support get a models list", async () => {
    localStorage.setItem(
      "dnt-store:providers",
      JSON.stringify([{ id: "p1", name: "Old", baseUrl: "http://o", model: "grok-4.5", apiKey: "" }]),
    );
    localStorage.setItem("dnt-store:activeProviderId", JSON.stringify("p1"));
    await reload();
    const p = useSettingsStore.getState().providers[0];
    expect(p.models).toEqual(["grok-4.5"]);
    expect(p.model).toBe("grok-4.5");
  });

  it("addProvider starts the models list with the preset model", async () => {
    await useSettingsStore.getState().addProvider({
      name: "OpenAI", baseUrl: "https://api.openai.com", model: "gpt-4o-mini", apiKey: "",
    });
    expect(useSettingsStore.getState().providers[1].models).toEqual(["gpt-4o-mini"]);
  });

  it("setModels saves several models (trimmed, deduped) and keeps the chosen one", async () => {
    const id = useSettingsStore.getState().providers[0].id;
    await useSettingsStore.getState().setModels(id, ["llama3.1", " qwen3 ", "qwen3", "", "gemma3"]);
    const p = useSettingsStore.getState().providers[0];
    expect(p.models).toEqual(["llama3.1", "qwen3", "gemma3"]);
    expect(p.model).toBe("llama3.1");
    const persisted = JSON.parse(localStorage.getItem("dnt-store:providers") ?? "[]");
    expect(persisted[0].models).toEqual(["llama3.1", "qwen3", "gemma3"]);
  });

  it("setModels falls back to the first model when the chosen one is dropped", async () => {
    const id = useSettingsStore.getState().providers[0].id;
    await useSettingsStore.getState().setModels(id, ["qwen3", "gemma3"]);
    expect(useSettingsStore.getState().providers[0].model).toBe("qwen3");
    await useSettingsStore.getState().setModels(id, []);
    expect(useSettingsStore.getState().providers[0].model).toBe("");
  });

  it("selectModel switches provider and model, and survives a reload", async () => {
    await useSettingsStore.getState().addProvider({
      name: "P2", baseUrl: "http://x", model: "m1", apiKey: "",
    });
    const id = useSettingsStore.getState().providers[1].id;
    await useSettingsStore.getState().setModels(id, ["m1", "m2"]);
    await useSettingsStore.getState().selectModel(id, "m2");
    expect(useSettingsStore.getState().activeProviderId).toBe(id);
    expect(useSettingsStore.getState().activeProvider()?.model).toBe("m2");

    await reload();
    expect(useSettingsStore.getState().activeProviderId).toBe(id);
    expect(useSettingsStore.getState().activeProvider()?.model).toBe("m2");
  });

  it("setActiveProvider survives a reload", async () => {
    await useSettingsStore.getState().addProvider({
      name: "P2", baseUrl: "http://x", model: "m1", apiKey: "",
    });
    const id = useSettingsStore.getState().providers[1].id;
    await useSettingsStore.getState().setActiveProvider(id);
    await reload();
    expect(useSettingsStore.getState().activeProviderId).toBe(id);
  });
});
