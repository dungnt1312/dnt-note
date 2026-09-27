import { describe, it, expect, vi, beforeEach } from "vitest";

const store = { raw: "" };
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
      read: vi.fn(async (id: string) => ({ id, title: `T${id}`, body: "b" })),
      list: vi.fn(async () => []),
    },
  },
}));
vi.mock("../llm/openai", () => ({
  embed: vi.fn(async ({ inputs }: { inputs: string[] }) => inputs.map((_, i) => [1, i])),
}));
vi.mock("../store/settingsStore", () => ({
  useSettingsStore: { getState: () => ({ activeProvider: () => null }) },
}));

import { embed } from "../llm/openai";
import { semanticApi } from "../api/semantic";
import { cosine, topK, staleIds, pruneDeleted, ensureIndex, semanticSearch, type EmbeddingIndex } from ".";

const provider = { id: "p", name: "P", baseUrl: "http://x", model: "m", apiKey: "", embeddingModel: "e1" };

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
  it("pruneDeleted drops dead ids", () => {
    const idx: EmbeddingIndex = { model: "e", entries: { a: { updated: "", vector: [] }, b: { updated: "", vector: [] } } };
    expect(Object.keys(pruneDeleted(idx, ["b"]).entries)).toEqual(["b"]);
  });
});

describe("ensureIndex", () => {
  beforeEach(() => {
    vi.mocked(embed).mockClear();
    vi.mocked(semanticApi.save).mockClear();
  });
  it("embeds only stale notes in batches of 32", async () => {
    store.raw = JSON.stringify({ model: "e1", entries: { n0: { updated: "u", vector: [9] } } });
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
  it("semanticSearch throws without embedding model", async () => {
    await expect(semanticSearch("x")).rejects.toThrow("Chưa cấu hình model embeddings");
  });
});
