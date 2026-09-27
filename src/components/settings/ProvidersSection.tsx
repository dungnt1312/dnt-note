import { useState } from "react";
import { Check, ChevronDown, Eye, EyeOff, Loader2, Plus, Trash2, X } from "lucide-react";
import { listModels, initLlmFetch } from "../../lib/llm/openai";
import { useSettingsStore, PROVIDER_PRESETS, type LlmProvider } from "../../lib/store/settingsStore";
import { isTauri } from "../../lib/env";
import { useUi } from "../../lib/store/uiStore";
import { api } from "../../lib/api/notes";
import { embeddingProvider, ensureIndex } from "../../lib/semantic";
import { cn } from "../../lib/utils";
import { SecondaryButton } from "../ui/Button";
import { ConfirmDialog } from "../ui/Dialog";
import { Menu, MenuItem } from "../ui/Menu";

async function tauriFetch(): Promise<typeof fetch | null> {
  if (!isTauri) return null;
  const { fetch: httpFetch } = await import("@tauri-apps/plugin-http");
  return httpFetch as unknown as typeof fetch;
}

export async function ensureLlmFetch(): Promise<void> {
  const f = await tauriFetch();
  if (f) initLlmFetch(f);
}

function Field({
  label,
  children,
  htmlFor,
  className,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-footnote font-medium text-fg-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}

const input =
  "h-9 w-full rounded-sm border border-hairline bg-app px-3 text-callout text-fg outline-none transition-colors focus:border-fg-tertiary";

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; count: number }
  | { kind: "fail"; message: string };

function ProviderCard({ provider, onDelete }: { provider: LlmProvider; onDelete: () => void }) {
  const upsert = useSettingsStore((s) => s.upsertProvider);
  const setActive = useSettingsStore((s) => s.setActiveProvider);
  const activeId = useSettingsStore((s) => s.activeProviderId);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [showKey, setShowKey] = useState(false);
  const active = activeId === provider.id;
  const id = (f: string) => `${provider.id}-${f}`;

  const runTest = async () => {
    setTest({ kind: "testing" });
    try {
      const f = await tauriFetch();
      const models = await listModels(provider.baseUrl, provider.apiKey || undefined, f ?? undefined);
      setTest({ kind: "ok", count: models.length });
    } catch (e) {
      setTest({ kind: "fail", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className={cn("rounded-md border bg-control p-4", active ? "border-fg-tertiary" : "border-hairline")}>
      <div className="flex items-center gap-2.5">
        <input
          id={id("name")}
          value={provider.name}
          aria-label="Tên nhà cung cấp"
          onChange={(e) => void upsert(provider.id, { name: e.target.value })}
          className="min-w-0 flex-1 rounded-sm bg-transparent px-1 py-0.5 text-body font-semibold text-fg outline-none hover:bg-hover focus:bg-hover"
        />
        {active ? (
          <span className="inline-flex h-5 items-center rounded-full bg-accent px-2 text-caption font-semibold text-accent-fg">
            Đang dùng
          </span>
        ) : (
          <SecondaryButton className="h-7 px-3" onClick={() => setActive(provider.id)}>
            Dùng
          </SecondaryButton>
        )}
        <button
          type="button"
          aria-label={`Xóa nhà cung cấp ${provider.name}`}
          title="Xóa nhà cung cấp"
          onClick={onDelete}
          className="flex size-7 items-center justify-center rounded-sm text-fg-tertiary transition-colors hover:bg-hover hover:text-danger"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Base URL" htmlFor={id("url")}>
          <input
            id={id("url")}
            value={provider.baseUrl}
            onChange={(e) => void upsert(provider.id, { baseUrl: e.target.value.trim() })}
            className={input}
            placeholder="https://api.openai.com"
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
        <Field label="Model" htmlFor={id("model")}>
          <input
            id={id("model")}
            value={provider.model}
            onChange={(e) => void upsert(provider.id, { model: e.target.value.trim() })}
            className={input}
            placeholder="gpt-4o-mini"
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
        <Field label="Model embeddings (tùy chọn)" htmlFor={id("embed")}>
          <input
            id={id("embed")}
            value={provider.embeddingModel ?? ""}
            onChange={(e) => void upsert(provider.id, { embeddingModel: e.target.value.trim() })}
            className={input}
            placeholder="text-embedding-3-small / nomic-embed-text"
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
        <Field label="Model chuyển giọng nói (tùy chọn)" htmlFor={id("stt")}>
          <input
            id={id("stt")}
            value={provider.transcriptionModel ?? ""}
            onChange={(e) => void upsert(provider.id, { transcriptionModel: e.target.value.trim() })}
            className={input}
            placeholder="whisper-1"
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
        <Field label="API key" htmlFor={id("key")} className="col-span-2">
          <div className="relative">
            <input
              id={id("key")}
              type={showKey ? "text" : "password"}
              value={provider.apiKey}
              onChange={(e) => void upsert(provider.id, { apiKey: e.target.value })}
              className={cn(input, "pr-10 font-mono")}
              placeholder="sk-… (để trống với Ollama local)"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              aria-label={showKey ? "Ẩn API key" : "Hiện API key"}
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-fg-tertiary hover:bg-hover hover:text-fg"
            >
              {showKey ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
            </button>
          </div>
        </Field>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <SecondaryButton onClick={() => void runTest()} disabled={test.kind === "testing"}>
          {test.kind === "testing" && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
          Kiểm tra kết nối
        </SecondaryButton>
        <span aria-live="polite" className="min-w-0 truncate text-footnote">
          {test.kind === "ok" && (
            <span className="inline-flex items-center gap-1 text-fg-secondary">
              <Check size={13} aria-hidden="true" /> Kết nối được · {test.count} model
            </span>
          )}
          {test.kind === "fail" && (
            <span className="inline-flex items-center gap-1 text-danger" title={test.message}>
              <X size={13} aria-hidden="true" /> {test.message}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function SemanticIndexingRow() {
  const enabled = useSettingsStore((s) => s.semanticIndexing);
  const setEnabled = useSettingsStore((s) => s.setSemanticIndexing);
  const pushToast = useUi((s) => s.pushToast);
  const [busy, setBusy] = useState(false);

  const buildNow = async () => {
    setBusy(true);
    try {
      const provider = embeddingProvider();
      const index = await ensureIndex(provider, await api.notes.list());
      pushToast({ message: `Đã lập chỉ mục ${Object.keys(index.entries).length} ghi chú`, durationMs: 4000 });
    } catch (e) {
      pushToast({ message: e instanceof Error ? e.message : String(e), durationMs: 6000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-hairline p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-callout font-medium text-fg">Tìm kiếm theo ý nghĩa</p>
          <p className="text-footnote text-fg-secondary">
            Khi bật, tiêu đề và nội dung ghi chú sẽ được gửi tới endpoint embeddings của nhà cung cấp đang chọn để
            lập chỉ mục (chỉ mục lưu trên máy). Cần nhập “Model embeddings” cho nhà cung cấp.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Tìm kiếm theo ý nghĩa"
          onClick={() => void setEnabled(!enabled)}
          className={cn("relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors", enabled ? "bg-accent" : "bg-hairline")}
        >
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-[left]",
              enabled ? "left-[18px]" : "left-[2px]",
            )}
          />
        </button>
      </div>
      {enabled && (
        <div>
          <SecondaryButton onClick={() => void buildNow()} disabled={busy}>
            {busy && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
            Tạo chỉ mục ngay
          </SecondaryButton>
        </div>
      )}
    </div>
  );
}

export function ProvidersSection() {
  const providers = useSettingsStore((s) => s.providers);
  const addProvider = useSettingsStore((s) => s.addProvider);
  const removeProvider = useSettingsStore((s) => s.removeProvider);
  const [deleting, setDeleting] = useState<LlmProvider | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {providers.map((p) => (
        <ProviderCard key={p.id} provider={p} onDelete={() => setDeleting(p)} />
      ))}
      <Menu
        align="start"
        side="top"
        width={260}
        trigger={(p) => (
          <button
            type="button"
            {...p}
            className="flex h-11 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-hairline text-callout font-medium text-fg-secondary transition-colors hover:bg-hover hover:text-fg"
          >
            <Plus size={15} aria-hidden="true" />
            Thêm nhà cung cấp
            <ChevronDown size={13} aria-hidden="true" />
          </button>
        )}
      >
        {PROVIDER_PRESETS.map((preset) => (
          <MenuItem key={preset.name} hint={preset.model} onSelect={() => void addProvider({ ...preset, apiKey: "" })}>
            {preset.name}
          </MenuItem>
        ))}
      </Menu>
      <SemanticIndexingRow />
      <ConfirmDialog
        open={deleting !== null}
        title={`Xóa nhà cung cấp “${deleting?.name ?? ""}”?`}
        description="API key đã lưu của nhà cung cấp này cũng sẽ bị xóa khỏi máy."
        confirmLabel="Xóa nhà cung cấp"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void removeProvider(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
