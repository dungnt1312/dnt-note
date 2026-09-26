import { useEffect, useState } from "react";
import { Plug, Plus, Trash2, Check, X } from "lucide-react";
import { listModels } from "../../lib/llm/openai";
import { initLlmFetch } from "../../lib/llm/openai";
import { useSettingsStore, PROVIDER_PRESETS, type LlmProvider } from "../../lib/store/settingsStore";
import { useUi } from "../../lib/store/uiStore";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriFetch(): Promise<typeof fetch | null> {
  if (!isTauri) return null;
  const { fetch: httpFetch } = await import("@tauri-apps/plugin-http");
  return httpFetch as unknown as typeof fetch;
}

export async function ensureLlmFetch(): Promise<void> {
  const f = await tauriFetch();
  if (f) initLlmFetch(f);
}

function ProviderRow({ provider }: { provider: LlmProvider }) {
  const upsert = useSettingsStore((s) => s.upsertProvider);
  const remove = useSettingsStore((s) => s.removeProvider);
  const setActive = useSettingsStore((s) => s.setActiveProvider);
  const activeId = useSettingsStore((s) => s.activeProviderId);
  const pushToast = useUi((s) => s.pushToast);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [showKey, setShowKey] = useState(false);

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const f = await tauriFetch();
      const models = await listModels(provider.baseUrl, provider.apiKey || undefined, f ?? undefined);
      setTestResult("ok");
      pushToast({
        message: `Kết nối OK — ${models.length} models (vd: ${models[0] ?? "?"})`,
        durationMs: 5000,
      });
    } catch (e) {
      setTestResult("fail");
      pushToast({ message: `Lỗi kết nối: ${e instanceof Error ? e.message : e}`, durationMs: 6000 });
    } finally {
      setTesting(false);
    }
  };

  const field = "px-2 py-1.5 text-[12.5px] rounded-[var(--radius-sm)] bg-[var(--bg-panel)] border border-[var(--border)] outline-none focus:border-[var(--accent)] text-[var(--text)] w-full";

  return (
    <div
      className={`rounded-[var(--radius-md)] border p-3 ${activeId === provider.id ? "border-[var(--accent)]" : "border-[var(--border)]"}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Plug size={14} className="text-[var(--text-secondary)]" />
        <input
          value={provider.name}
          onChange={(e) => void upsert(provider.id, { name: e.target.value })}
          className={`${field} max-w-[160px] font-medium`}
          placeholder="Tên provider"
        />
        {activeId === provider.id ? (
          <span className="text-[11px] text-[var(--accent)] font-medium">Đang dùng</span>
        ) : (
          <button
            onClick={() => setActive(provider.id)}
            className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent)]"
          >
            Dùng
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={() => void test()}
          disabled={testing}
          className="text-[11.5px] px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] hover:border-[var(--accent)] text-[var(--text-secondary)] disabled:opacity-50"
        >
          {testing ? "Đang test…" : "Kiểm tra kết nối"}
        </button>
        {testResult === "ok" && <Check size={14} className="text-green-500" />}
        {testResult === "fail" && <X size={14} className="text-[var(--danger)]" />}
        <button
          onClick={() => void remove(provider.id)}
          title="Xóa provider"
          className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-faint)] hover:text-[var(--danger)]"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <div>
          <label className="text-[11px] text-[var(--text-faint)]">Base URL</label>
          <input
            value={provider.baseUrl}
            onChange={(e) => void upsert(provider.id, { baseUrl: e.target.value.trim() })}
            className={field}
            placeholder="https://api.openai.com"
          />
        </div>
        <div>
          <label className="text-[11px] text-[var(--text-faint)]">Model</label>
          <input
            value={provider.model}
            onChange={(e) => void upsert(provider.id, { model: e.target.value.trim() })}
            className={field}
            placeholder="gpt-4o-mini"
          />
        </div>
        <div className="col-span-2">
          <label className="text-[11px] text-[var(--text-faint)]">API Key</label>
          <input
            type={showKey ? "text" : "password"}
            value={provider.apiKey}
            onChange={(e) => void upsert(provider.id, { apiKey: e.target.value })}
            onFocus={() => setShowKey(true)}
            onBlur={() => setShowKey(false)}
            className={field}
            placeholder="sk-… (Ollama local để trống)"
          />
        </div>
      </div>
    </div>
  );
}

export function ProvidersSection() {
  const providers = useSettingsStore((s) => s.providers);
  const loaded = useSettingsStore((s) => s.loaded);
  const loadStore = useSettingsStore((s) => s.loadStore);
  const addProvider = useSettingsStore((s) => s.addProvider);
  const [presetIdx, setPresetIdx] = useState(0);

  useEffect(() => {
    if (!loaded) void loadStore();
  }, [loaded, loadStore]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-[var(--text-secondary)]">
        Hỗ trợ mọi provider chuẩn OpenAI-compatible. Keys lưu trong
        <code className="mx-1 px-1 rounded bg-[var(--code-bg)]">providers.json</code>
        trên máy bạn, không gửi đi đâu ngoài provider bạn chọn.
      </p>
      {providers.map((p) => (
        <ProviderRow key={p.id} provider={p} />
      ))}
      <div className="flex items-center gap-2">
        <select
          value={presetIdx}
          onChange={(e) => setPresetIdx(Number(e.target.value))}
          className="px-2 py-1.5 text-[12.5px] rounded-[var(--radius-sm)] bg-[var(--bg-panel)] border border-[var(--border)] outline-none text-[var(--text)]"
        >
          {PROVIDER_PRESETS.map((p, i) => (
            <option key={p.name} value={i}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            const preset = PROVIDER_PRESETS[presetIdx];
            void addProvider({ ...preset, apiKey: "" });
          }}
          className="flex items-center gap-1.5 text-[12.5px] px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] hover:border-[var(--accent)] text-[var(--text-secondary)]"
        >
          <Plus size={13} /> Thêm provider
        </button>
      </div>
    </div>
  );
}
