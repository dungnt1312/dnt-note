import { describe, it, expect, vi, beforeEach } from "vitest";

const store = { raw: "" };
const settings: { semanticIndexing: boolean; activeProvider: () => unknown } = {
  semanticIndexing: true,
  activeProvider: () => null,
};
vi.mock("../api/semantic", () => ({
  semanticApi: {
    load: vi.fn(async () => store.raw),
    save: vi.fn(async (json: string) => {
      store.raw = json;
    }),
  },
}));
vi.mock("../api/notes", () => ({
  api: {
    notes: {
      read: vi.fn(async (id: string) => {
        if (id === "bad") throw new Error("gone");
        return { id, title: `T${id}`, body: "b" };
      }),
      list: vi.fn(async () => []),
    },
  },
}));
vi.mock("../llm/openai", () => ({
  embed: vi.fn(async ({ inputs }: { inputs: string[] }) => inputs.map((_, i) => [1, i])),
}));
vi.mock("../store/settingsStore", () => ({
  useSettingsStore: { getState: () => settings },
}));

import { embed } from "../llm/openai";
import { semanticApi } from "../api/semantic";
import { INDEXING_DISABLED, cosine, topK, staleIds, pruneDeleted, ensureIndex, semanticSearch, type EmbeddingIndex } from ".";

const provider = { id: "p", name: "P", baseUrl: "http://x", model: "m", apiKey: "", embeddingModel: "e1", models: ["m"] };

describe("pure helpers", () => {
  it("cosine", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });
  it("topK sorts by score and limits", () => {
    const entries = {
      a: { updated: "", vector: [1, 0] },
      b: { updated: "", vector: [0, 1] },
      c: { updated: "", vector: [1, 1] },
    };
    expect(topK([1, 0], entries, 2).map((r) => r.id)).toEqual(["a", "c"]);
  });
  it("staleIds detects missing, changed and model switch", () => {
    const idx: EmbeddingIndex = { model: "e1", entries: { a: { updated: "1", vector: [] }, b: { updated: "1", vector: [] } } };
    const notes = [{ id: "a", updated: "1" }, { id: "b", updated: "2" }, { id: "c", updated: "1" }];
    expect(staleIds(idx, notes, "e1")).toEqual(["b", "c"]);
    expect(staleIds(idx, notes, "e2")).toEqual(["a", "b", "c"]);
  });
  it("staleIds treats baseUrl change and vector length mismatch as stale", () => {
    const idx: EmbeddingIndex = {
      model: "e1",
      baseUrl: "http://a",
      entries: { a: { updated: "1", vector: [1, 2] }, b: { updated: "1", vector: [1] } },
    };
    const notes = [{ id: "a", updated: "1" }, { id: "b", updated: "1" }];
    expect(staleIds(idx, notes, "e1", "http://b")).toEqual(["a", "b"]);
    expect(staleIds(idx, notes, "e1", "http://a")).toEqual(["b"]);
    expect(staleIds(idx, notes, "e1", "http://a", 1)).toEqual(["a"]);
  });
  it("pruneDeleted drops dead ids", () => {
    const idx: EmbeddingIndex = { model: "e", entries: { a: { updated: "", vector: [] }, b: { updated: "", vector: [] } } };
    expect(Object.keys(pruneDeleted(idx, ["b"]).entries)).toEqual(["b"]);
  });
});

describe("ensureIndex", () => {
  beforeEach(() => {
    vi.mocked(embed).mockClear();
    vi.mocked(semanticApi.save).mockClear();
    vi.mocked(semanticApi.load).mockClear();
  });
  it("embeds only stale notes in batches of 32", async () => {
    store.raw = JSON.stringify({ model: "e1", baseUrl: "http://x", entries: { n0: { updated: "u", vector: [9] } } });
    const notes = Array.from({ length: 41 }, (_, i) => ({ id: `n${i}`, updated: "u" }));
    const idx = await ensureIndex(provider, notes);
    const calls = vi.mocked(embed).mock.calls.map((c) => c[0].inputs.length);
    expect(calls).toEqual([32, 8]);
    expect(Object.keys(idx.entries)).toHaveLength(41);
    expect(idx.entries.n0!.vector).toEqual([9]);
    expect(JSON.parse(store.raw).entries.n40).toBeTruthy();
  });
  it("shares a single in-flight run", async () => {
    store.raw = "";
    const notes = [{ id: "a", updated: "1" }];
    const [x, y] = await Promise.all([ensureIndex(provider, notes), ensureIndex(provider, notes)]);
    expect(x).toBe(y);
    expect(vi.mocked(embed)).toHaveBeenCalledTimes(1);
  });
  it("skips notes that fail to read and stores baseUrl", async () => {
    store.raw = "";
    const idx = await ensureIndex(provider, [{ id: "ok", updated: "1" }, { id: "bad", updated: "1" }]);
    expect(Object.keys(idx.entries)).toEqual(["ok"]);
    expect(idx.baseUrl).toBe("http://x");
  });
  it("rebuilds when baseUrl changed", async () => {
    store.raw = JSON.stringify({ model: "e1", baseUrl: "http://old", entries: { a: { updated: "1", vector: [1, 0] } } });
    await ensureIndex(provider, [{ id: "a", updated: "1" }]);
    expect(vi.mocked(embed)).toHaveBeenCalledTimes(1);
  });
  it("consent gate: ensureIndex and semanticSearch refuse when disabled", async () => {
    settings.semanticIndexing = false;
    try {
      await expect(ensureIndex(provider, [{ id: "a", updated: "1" }])).rejects.toThrow(INDEXING_DISABLED);
      await expect(semanticSearch("x")).rejects.toThrow(INDEXING_DISABLED);
      expect(vi.mocked(embed)).not.toHaveBeenCalled();
      expect(vi.mocked(semanticApi.load)).not.toHaveBeenCalled();
    } finally {
      settings.semanticIndexing = true;
    }
  });
  it("semanticSearch throws without embedding model", async () => {
    await expect(semanticSearch("x")).rejects.toThrow("Chưa cấu hình model embeddings");
  });
});
