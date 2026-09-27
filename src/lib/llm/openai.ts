/**
 * Minimal OpenAI-compatible chat-completions client with SSE streaming.
 * Works with OpenAI, Ollama, OpenRouter, Groq, vLLM — anything that speaks
 * POST {baseUrl}/chat/completions (+ GET /models for listing).
 */

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCallFragment {
  index: number;
  id?: string | undefined;
  name?: string | undefined;
  args: string;
}

export interface StreamDelta {
  content: string;
  toolCalls: ToolCallFragment[];
}

export interface StreamResult {
  content: string;
  toolCalls: { id: string; name: string; arguments: string }[];
}

/** Parse SSE text into JSON deltas; returns leftover partial event. */
export function parseSseChunk(buffer: string): { deltas: Record<string, unknown>[]; rest: string } {
  const deltas: Record<string, unknown>[] = [];
  const events = buffer.split(/\r?\n\r?\n/);
  const rest = events.pop() ?? "";
  for (const event of events) {
    for (const line of event.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        deltas.push(JSON.parse(payload));
      } catch {
        // skip malformed event — next chunk continues the stream
      }
    }
  }
  return { deltas, rest };
}

/** Merge one streamed tool-call fragment into `calls` (keyed by index). */
export function extractToolCallDelta(
  calls: Record<number, { id: string; name: string; arguments: string }>,
  fragment: ToolCallFragment,
): void {
  const existing = calls[fragment.index];
  if (existing) {
    if (fragment.id) existing.id = fragment.id;
    if (fragment.name) existing.name = fragment.name;
    existing.arguments += fragment.args;
  } else {
    calls[fragment.index] = {
      id: fragment.id ?? `call_${fragment.index}`,
      name: fragment.name ?? "",
      arguments: fragment.args,
    };
  }
}

interface WireChoiceDelta {
  content?: string | null;
  tool_calls?: {
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
}

function readResponseBody(res: Response): string {
  // Response body must be read by caller; this helper is for error paths.
  return res.statusText;
}

export function providerUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  // Users may enter base with or without /v1
  const withV1 = /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
  return `${withV1}${path}`;
}

export interface StreamChatOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  signal?: AbortSignal;
  onDelta?: (delta: StreamDelta) => void;
  /** Fetch override for tests. Defaults to Tauri plugin-http fetch. */
  fetchImpl?: typeof fetch;
}

/** Stream a chat completion; returns the fully assembled message parts. */
export async function streamChat(options: StreamChatOptions): Promise<StreamResult> {
  const doFetch = options.fetchImpl ?? defaultFetch();
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: true,
  };
  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }
  const res = await doFetch(providerUrl(options.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => readResponseBody(res));
    throw new Error(`LLM ${res.status}: ${detail.slice(0, 400)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const calls: Record<number, { id: string; name: string; arguments: string }> = {};

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { deltas, rest } = parseSseChunk(buffer);
    buffer = rest;
    for (const d of deltas) {
      const choice = (d as { choices?: { delta?: WireChoiceDelta }[] }).choices?.[0];
      const delta = choice?.delta;
      if (!delta) continue;
      const text = delta.content ?? "";
      if (text) content += text;
      const frags: ToolCallFragment[] = (delta.tool_calls ?? []).map((tc) => ({
        index: tc.index,
        id: tc.id,
        name: tc.function?.name,
        args: tc.function?.arguments ?? "",
      }));
      for (const f of frags) extractToolCallDelta(calls, f);
      if (text || frags.length) options.onDelta?.({ content: text, toolCalls: frags });
    }
  }

  return {
    content,
    toolCalls: Object.entries(calls)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, c]) => c),
  };
}

/** GET /models → list of model ids (also used as connection test). */
export async function listModels(
  baseUrl: string,
  apiKey?: string,
  fetchImpl?: typeof fetch,
): Promise<string[]> {
  const doFetch = fetchImpl ?? defaultFetch();
  const res = await doFetch(providerUrl(baseUrl, "/models"), {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id);
}

function defaultFetch(): typeof fetch {
  // Dynamic import keeps this module testable in plain vitest (no Tauri).
  // The sync requirement means we bind at call time via a resolved promise.
  return (...args) => {
    if (!boundFetch) throw new Error("Tauri http fetch not initialised");
    return boundFetch(...args);
  };
}

let boundFetch: typeof fetch | null = null;

/** Called once from the app entrypoint (Tauri runtime only). */
export function initLlmFetch(fetchImpl: typeof fetch): void {
  boundFetch = fetchImpl;
}

/** Test hook: reset the bound fetch. */
export function resetLlmFetch(): void {
  boundFetch = null;
}

export interface EmbedOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  inputs: string[];
  fetchImpl?: typeof fetch;
}

/** POST /embeddings → one vector per input, in input order. */
export async function embed(options: EmbedOptions): Promise<number[][]> {
  if (!options.inputs.length) return [];
  const doFetch = options.fetchImpl ?? defaultFetch();
  const res = await doFetch(providerUrl(options.baseUrl, "/embeddings"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: options.model, input: options.inputs }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const json = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
  return [...(json.data ?? [])].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
