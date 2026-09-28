import { useState } from "react";
import { Check, ChevronDown, Eye, EyeOff, Loader2, Plus, Trash2, X } from "lucide-react";
import { listModels, initLlmFetch } from "../../lib/llm/openai";
import { useSettingsStore, PROVIDER_PRESETS, type LlmProvider } from "../../lib/store/settingsStore";
import { isTauri } from "../../lib/env";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { SecondaryButton } from "../ui/Button";
import { ConfirmDialog } from "../ui/Dialog";
import { Menu, MenuItem } from "../ui/Menu";
import { ModelPickerDialog } from "./ModelPickerDialog";

async function tauriFetch(): Promise<typeof fetch | null> {
  if (!isTauri) return null;
  const { fetch: httpFetch } = await import("@tauri-apps/plugin-http");
  return httpFetch as unknown as typeof fetch;
}

export async function ensureLlmFetch(): Promise<void> {
  const f = await tauriFetch();
  if (f) initLlmFetch(f);
}

async function fetchModels(provider: LlmProvider): Promise<string[]> {
  const f = await tauriFetch();
  return listModels(provider.baseUrl, provider.apiKey || undefined, f ?? undefined);
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

/** Saved models as chips: click one to chat with it, × to drop it, last chip opens the picker. */
function ModelChips({
  provider,
  active,
  labelledBy,
  onPick,
}: {
  provider: LlmProvider;
  /** The provider the chat uses — its current model chip is filled. */
  active: boolean;
  labelledBy: string;
  onPick: () => void;
}) {
  const selectModel = useSettingsStore((s) => s.selectModel);
  const setModels = useSettingsStore((s) => s.setModels);
  const t = useT();

  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap items-center gap-1.5">
      {provider.models.map((m) => {
        const current = m === provider.model;
        const inUse = current && active;
        return (
          <span
            key={m}
            className={cn(
              "inline-flex h-7 max-w-full items-center rounded-full border text-footnote font-medium transition-colors",
              inUse
                ? "border-accent bg-accent text-accent-fg"
                : current
                  ? "border-fg-tertiary bg-app text-fg hover:bg-hover"
                  : "border-hairline bg-app text-fg hover:bg-hover",
            )}
          >
            <button
              type="button"
              aria-pressed={current}
              title={inUse ? t("settings.modelInUseTitle", { model: m }) : t("settings.useModelTitle", { model: m })}
              onClick={() => void selectModel(provider.id, m)}
              className="inline-flex h-full min-w-0 items-center gap-1 rounded-l-full pl-2.5 pr-1"
            >
              {current && <Check size={12} strokeWidth={2.5} aria-hidden="true" className="shrink-0" />}
              <span className="truncate">{m}</span>
            </button>
            <button
              type="button"
              aria-label={t("settings.removeModelAria", { model: m })}
              title={t("settings.removeModel")}
              onClick={() => void setModels(provider.id, provider.models.filter((x) => x !== m))}
              className={cn(
                "mr-1 flex size-5 shrink-0 items-center justify-center rounded-full transition-colors",
                inUse
                  ? "text-accent-fg/60 hover:bg-accent-fg/15 hover:text-accent-fg"
                  : "text-fg-tertiary hover:bg-selected hover:text-fg",
              )}
            >
              <X size={11} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </span>
        );
      })}
      <button
        type="button"
        onClick={onPick}
        className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-hairline px-2.5 text-footnote font-medium text-fg-secondary transition-colors hover:bg-hover hover:text-fg"
      >
        <Plus size={12} strokeWidth={2.5} aria-hidden="true" />
        {t("settings.chooseModel")}
      </button>
    </div>
  );
}

function ProviderCard({ provider, onDelete }: { provider: LlmProvider; onDelete: () => void }) {
  const upsert = useSettingsStore((s) => s.upsertProvider);
  const setModels = useSettingsStore((s) => s.setModels);
  const setActive = useSettingsStore((s) => s.setActiveProvider);
  const activeId = useSettingsStore((s) => s.activeProviderId);
  const t = useT();
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [showKey, setShowKey] = useState(false);
  const [picking, setPicking] = useState(false);
  const active = activeId === provider.id;
  const id = (f: string) => `${provider.id}-${f}`;

  const runTest = async () => {
    setTest({ kind: "testing" });
    try {
      const models = await fetchModels(provider);
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
          aria-label={t("settings.providerNameLabel")}
          title={t("settings.renameHint")}
          onChange={(e) => void upsert(provider.id, { name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="min-w-0 flex-1 rounded-sm border-b border-transparent bg-transparent px-1 py-0.5 text-body font-semibold text-fg outline-none transition-colors hover:border-fg-tertiary hover:bg-hover focus:border-fg-tertiary focus:bg-hover"
        />
        {active ? (
          <span className="inline-flex h-5 items-center rounded-full bg-accent px-2 text-caption font-semibold text-accent-fg">
            {t("settings.inUse")}
          </span>
        ) : (
          <SecondaryButton className="h-7 px-3" onClick={() => void setActive(provider.id)}>
            {t("settings.use")}
          </SecondaryButton>
        )}
        <button
          type="button"
          aria-label={t("settings.deleteProviderAria", { name: provider.name })}
          title={t("settings.deleteProvider")}
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
        <Field label="API key" htmlFor={id("key")}>
          <div className="relative">
            <input
              id={id("key")}
              type={showKey ? "text" : "password"}
              value={provider.apiKey}
              onChange={(e) => void upsert(provider.id, { apiKey: e.target.value })}
              className={cn(input, "pr-10 font-mono")}
              placeholder={t("settings.apiKeyPlaceholder")}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              aria-label={showKey ? t("settings.hideApiKey") : t("settings.showApiKey")}
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-fg-tertiary hover:bg-hover hover:text-fg"
            >
              {showKey ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
            </button>
          </div>
        </Field>
      </div>

      <div className="mt-3">
        <div id={id("models")} className="mb-1.5 text-footnote font-medium text-fg-secondary">
          {t("settings.modelLabel")}
        </div>
        <ModelChips provider={provider} active={active} labelledBy={id("models")} onPick={() => setPicking(true)} />
      </div>

      <div className="mt-3.5 flex items-center gap-3">
        <SecondaryButton onClick={() => void runTest()} disabled={test.kind === "testing"}>
          {test.kind === "testing" && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
          {t("settings.testConnection")}
        </SecondaryButton>
        <span aria-live="polite" className="min-w-0 truncate text-footnote">
          {test.kind === "ok" && (
            <span className="inline-flex items-center gap-1 text-fg-secondary">
              <Check size={13} aria-hidden="true" /> {t("settings.connectionOk", { count: test.count })}
            </span>
          )}
          {test.kind === "fail" && (
            <span className="inline-flex items-center gap-1 text-danger" title={test.message}>
              <X size={13} aria-hidden="true" /> {test.message}
            </span>
          )}
        </span>
      </div>

      <ModelPickerDialog
        open={picking}
        providerName={provider.name}
        saved={provider.models}
        loadModels={() => fetchModels(provider)}
        onSave={(models) => {
          void setModels(provider.id, models);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </div>
  );
}

export function ProvidersSection() {
  const providers = useSettingsStore((s) => s.providers);
  const addProvider = useSettingsStore((s) => s.addProvider);
  const removeProvider = useSettingsStore((s) => s.removeProvider);
  const t = useT();
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
            {t("settings.addProvider")}
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
      <ConfirmDialog
        open={deleting !== null}
        title={t("settings.deleteProviderTitle", { name: deleting?.name ?? "" })}
        description={t("settings.deleteProviderDescription")}
        confirmLabel={t("settings.deleteProviderConfirm")}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void removeProvider(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
