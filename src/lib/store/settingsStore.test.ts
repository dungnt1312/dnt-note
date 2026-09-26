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
    await useSettingsStore.getState().upsertProvider(id, { model: "m2" });
    expect(useSettingsStore.getState().providers[1].model).toBe("m2");
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
