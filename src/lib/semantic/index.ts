import { api } from "../api/notes";
import { semanticApi } from "../api/semantic";
import { embed } from "../llm/openai";
import { useSettingsStore, type LlmProvider } from "../store/settingsStore";

export interface IndexEntry {
  updated: string;
  vector: number[];
}

export interface EmbeddingIndex {
  model: string;
  baseUrl?: string;
  entries: Record<string, IndexEntry>;
}

export interface SemanticResult {
  id: string;
  title: string;
  score: number;
  snippet: string;
}

export const BATCH_SIZE = 32;
export const MAX_EMBED_CHARS = 8000;
export const INDEXING_DISABLED =
  "Tìm theo ý nghĩa đang tắt — bật trong Cài đặt → Nhà cung cấp AI (sẽ gửi nội dung ghi chú tới nhà cung cấp embeddings).";
export const NO_EMBEDDING_MODEL =
  "Chưa cấu hình model embeddings cho nhà cung cấp hiện tại — vào Cài đặt → Nhà cung cấp AI.";

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function topK(
  query: number[],
  entries: Record<string, IndexEntry>,
  k: number,
): { id: string; score: number }[] {
  return Object.entries(entries)
    .map(([id, e]) => ({ id, score: cosine(query, e.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, k));
}

/** True when the whole index must be rebuilt (different model/endpoint). */
export function indexMismatch(index: EmbeddingIndex, model: string, baseUrl?: string): boolean {
  if (index.model !== model) return true;
  return baseUrl !== undefined && (index.baseUrl ?? "") !== baseUrl;
}

export function staleIds(
  index: EmbeddingIndex,
  notes: { id: string; updated: string }[],
  model: string,
  baseUrl?: string,
  dim?: number,
): string[] {
  if (indexMismatch(index, model, baseUrl)) return notes.map((n) => n.id);
  const expected = dim ?? Object.values(index.entries)[0]?.vector.length;
  return notes
    .filter((n) => {
      const e = index.entries[n.id];
      return !e || e.updated !== n.updated || (expected !== undefined && e.vector.length !== expected);
    })
    .map((n) => n.id);
}

export function pruneDeleted(index: EmbeddingIndex, liveIds: string[]): EmbeddingIndex {
  const live = new Set(liveIds);
  const entries: Record<string, IndexEntry> = {};
  for (const [id, e] of Object.entries(index.entries)) if (live.has(id)) entries[id] = e;
  return { ...index, entries };
}

export function assertIndexingEnabled(): void {
  if (!useSettingsStore.getState().semanticIndexing) throw new Error(INDEXING_DISABLED);
}

export function embeddingProvider(): LlmProvider & { embeddingModel: string } {
  assertIndexingEnabled();
  const p = useSettingsStore.getState().activeProvider();
  if (!p?.embeddingModel) throw new Error(NO_EMBEDDING_MODEL);
  return p as LlmProvider & { embeddingModel: string };
}

async function loadIndex(model: string): Promise<EmbeddingIndex> {
  const raw = await semanticApi.load();
  if (!raw) return { model, entries: {} };
  try {
    const parsed = JSON.parse(raw) as EmbeddingIndex;
    if (typeof parsed.model === "string" && parsed.entries) return parsed;
  } catch {
    // corrupted index — rebuild
  }
  return { model, entries: {} };
}

let inFlight: Promise<EmbeddingIndex> | null = null;

/** Bring the on-disk index up to date; concurrent callers share one run. */
export function ensureIndex(
  provider: LlmProvider & { embeddingModel: string },
  notes: { id: string; updated: string }[],
  dim?: number,
): Promise<EmbeddingIndex> {
  if (!useSettingsStore.getState().semanticIndexing) return Promise.reject(new Error(INDEXING_DISABLED));
  if (!inFlight) {
    inFlight = buildIndex(provider, notes, dim).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function buildIndex(
  provider: LlmProvider & { embeddingModel: string },
  notes: { id: string; updated: string }[],
  dim?: number,
): Promise<EmbeddingIndex> {
  const model = provider.embeddingModel;
  const baseUrl = provider.baseUrl;
  const loaded = await loadIndex(model);
  const mismatch = indexMismatch(loaded, model, baseUrl);
  const stale = staleIds(loaded, notes, model, baseUrl, dim);
  let index = pruneDeleted(
    mismatch ? { model, baseUrl, entries: {} } : { ...loaded, baseUrl },
    notes.map((n) => n.id),
  );
  const pruned = Object.keys(index.entries).length !== Object.keys(loaded.entries).length;
  if (!stale.length) {
    if (pruned || mismatch || loaded.baseUrl !== baseUrl) await semanticApi.save(JSON.stringify(index));
    return index;
  }
  const updatedById = new Map(notes.map((n) => [n.id, n.updated]));
  for (let i = 0; i < stale.length; i += BATCH_SIZE) {
    const batch = stale.slice(i, i + BATCH_SIZE);
    const read = await Promise.all(
      batch.map((id) =>
        api.notes.read(id).catch((e) => {
          console.warn("semantic: skip note", id, e);
          return null;
        }),
      ),
    );
    const ids: string[] = [];
    const texts: string[] = [];
    read.forEach((n, j) => {
      if (!n) return;
      ids.push(batch[j]!);
      texts.push(`${n.title}\n${n.body}`.slice(0, MAX_EMBED_CHARS));
    });
    if (!ids.length) continue;
    const vectors = await embed({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey || undefined,
      model,
      inputs: texts,
    });
    index = { model, baseUrl, entries: { ...index.entries } };
    ids.forEach((id, j) => {
      const vector = vectors[j];
      if (vector) index.entries[id] = { updated: updatedById.get(id) ?? "", vector };
    });
    // Save per batch so a failure mid-way keeps progress.
    await semanticApi.save(JSON.stringify(index));
  }
  return index;
}

export async function semanticSearch(query: string, limit = 8): Promise<SemanticResult[]> {
  const provider = embeddingProvider();
  const q = query.trim();
  if (!q) return [];
  const notes = await api.notes.list();
  const [qv] = await embed({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey || undefined,
    model: provider.embeddingModel,
    inputs: [q],
  });
  if (!qv) return [];
  const index = await ensureIndex(provider, notes, qv.length);
  const byId = new Map(notes.map((n) => [n.id, n]));
  return topK(qv, index.entries, limit)
    .filter((r) => byId.has(r.id))
    .map((r) => {
      const n = byId.get(r.id)!;
      return { id: r.id, title: n.title, score: r.score, snippet: n.snippet };
    });
}
