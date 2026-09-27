import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const disk = new Map<string, unknown>();
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: async (k: string) => disk.get(k),
    set: async (k: string, v: unknown) => void disk.set(k, JSON.parse(JSON.stringify(v))),
    save: async () => {},
  })),
}));

const vault = new Map<string, string>();
const secrets = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("../api/secrets", () => ({ secretsApi: secrets }));

import { useSettingsStore, __resetStoreCache } from "./settingsStore";
import { useUi } from "./uiStore";

const prov = (over: Record<string, unknown> = {}) => ({
  id: "p_1", name: "OpenAI", baseUrl: "https://api.openai.com", model: "m", apiKey: "", ...over,
});

describe("settingsStore credential vault (Tauri)", () => {
  beforeEach(() => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    __resetStoreCache();
    disk.clear();
    vault.clear();
    secrets.set.mockReset().mockImplementation(async (k: string, v: string) => void vault.set(k, v));
    secrets.get.mockReset().mockImplementation(async (k: string) => vault.get(k) ?? null);
    secrets.delete.mockReset().mockImplementation(async (k: string) => void vault.delete(k));
    useSettingsStore.setState({ providers: [], activeProviderId: null, loaded: false });
    useUi.setState({ toasts: [] });
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    __resetStoreCache();
  });

  it("migrates plaintext key to vault and blanks file value", async () => {
    disk.set("providers", [prov({ apiKey: "sk-plain" })]);
    await useSettingsStore.getState().loadStore();
    expect(vault.get("provider:p_1")).toBe("sk-plain");
    expect(disk.get("providers")).toEqual([prov({ apiKey: "", keyInVault: true })]);
    expect(useSettingsStore.getState().providers[0].apiKey).toBe("sk-plain");
  });

  it("load restores key from vault into memory", async () => {
    disk.set("providers", [prov({ keyInVault: true })]);
    vault.set("provider:p_1", "sk-vault");
    await useSettingsStore.getState().loadStore();
    expect(useSettingsStore.getState().providers[0].apiKey).toBe("sk-vault");
    expect(secrets.set).not.toHaveBeenCalled();
  });

  it("missing vault entry yields empty key", async () => {
    disk.set("providers", [prov({ keyInVault: true })]);
    await useSettingsStore.getState().loadStore();
    expect(useSettingsStore.getState().providers[0].apiKey).toBe("");
  });

  it("vault failure keeps plaintext and toasts once", async () => {
    secrets.set.mockRejectedValue(new Error("no vault"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    disk.set("providers", [prov({ apiKey: "sk-plain" })]);
    await useSettingsStore.getState().loadStore();
    expect((disk.get("providers") as { apiKey: string }[])[0].apiKey).toBe("sk-plain");
    expect(useSettingsStore.getState().providers[0].apiKey).toBe("sk-plain");
    await useSettingsStore.getState().upsertProvider("p_1", { model: "m2" });
    expect(useUi.getState().toasts.length).toBeLessThanOrEqual(1);
    warn.mockRestore();
  });

  it("clearing the key deletes the secret", async () => {
    disk.set("providers", [prov({ keyInVault: true })]);
    vault.set("provider:p_1", "sk");
    await useSettingsStore.getState().loadStore();
    await useSettingsStore.getState().upsertProvider("p_1", { apiKey: "" });
    expect(vault.has("provider:p_1")).toBe(false);
    expect((disk.get("providers") as { keyInVault: boolean }[])[0].keyInVault).toBe(false);
  });

  it("removeProvider deletes the secret", async () => {
    disk.set("providers", [prov({ keyInVault: true })]);
    vault.set("provider:p_1", "sk");
    await useSettingsStore.getState().loadStore();
    await useSettingsStore.getState().removeProvider("p_1");
    expect(secrets.delete).toHaveBeenCalledWith("provider:p_1");
    expect(vault.size).toBe(0);
  });

  it("browser mode never touches the vault", async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    __resetStoreCache();
    localStorage.clear();
    await useSettingsStore.getState().loadStore();
    await useSettingsStore.getState().addProvider({ name: "X", baseUrl: "http://x", model: "m", apiKey: "sk-b" });
    const id = useSettingsStore.getState().providers[1].id;
    await useSettingsStore.getState().removeProvider(id);
    const persisted = JSON.parse(localStorage.getItem("dnt-store:providers") ?? "[]");
    expect(persisted[0].apiKey).toBe("");
    expect(secrets.set).not.toHaveBeenCalled();
    expect(secrets.get).not.toHaveBeenCalled();
    expect(secrets.delete).not.toHaveBeenCalled();
  });
});
