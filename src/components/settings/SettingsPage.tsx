import { useEffect, useState, type ReactNode } from "react";
import { FolderOpen, FolderSync, Trash2 } from "lucide-react";
import { api } from "../../lib/api/notes";
import { syncApi } from "../../lib/api/attachments";
import { useUi } from "../../lib/store/uiStore";
import { useSettingsStore } from "../../lib/store/settingsStore";
import { isTauri } from "../../lib/env";
import { cn } from "../../lib/utils";
import { useLangStore, useT, type Lang } from "../../lib/i18n";
import { useTheme, type Theme } from "../theme/ThemeProvider";
import { ContentHeader } from "../layout/ContentHeader";
import { Keycap, SecondaryButton } from "../ui/Button";
import { ConfirmDialog } from "../ui/Dialog";
import { ProvidersSection } from "./ProvidersSection";

type TKey = Parameters<ReturnType<typeof useT>>[0];

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`s-${title}`} className="flex flex-col gap-3">
      <div>
        <h2 id={`s-${title}`} className="text-headline font-semibold text-fg">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-callout text-fg-secondary">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** Grouped rows with hairline separators (iOS-settings style card). */
function RowGroup({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-hairline overflow-hidden rounded-md border border-hairline bg-control">
      {children}
    </div>
  );
}

function Row({ label, description, children }: { label: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center gap-4 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-callout text-fg">{label}</div>
        {description && <div className="text-footnote text-fg-secondary">{description}</div>}
      </div>
      {children}
    </div>
  );
}

function ThemePreview({ dark }: { dark: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="flex h-[74px] w-full overflow-hidden rounded-sm"
      style={{ background: dark ? "#212121" : "#ffffff" }}
    >
      <div className="w-[22px] shrink-0" style={{ background: dark ? "#181818" : "#f9f9f9" }} />
      <div className="flex flex-1 flex-col justify-center gap-1.5 px-3">
        <div className="h-[5px] w-[34px] rounded-full" style={{ background: dark ? "#ececec" : "#0d0d0d" }} />
        <div className="h-1 w-[50px] rounded-full" style={{ background: dark ? "#5a5a5a" : "#d0d0d0" }} />
        <div className="h-1 w-10 rounded-full" style={{ background: dark ? "#5a5a5a" : "#d0d0d0" }} />
      </div>
    </div>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const t = useT();
  const options: { value: Theme; label: string }[] = [
    { value: "light", label: t("settings.themeLight") },
    { value: "dark", label: t("settings.themeDark") },
    { value: "system", label: t("settings.themeSystem") },
  ];
  return (
    <Section title={t("settings.appearance")}>
      <div role="radiogroup" aria-label={t("settings.themeGroupLabel")} className="grid grid-cols-3 gap-2.5">
        {options.map((o) => {
          const selected = theme === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(o.value)}
              className="flex flex-col items-center gap-2 text-left"
            >
              <span
                className={cn(
                  "block w-full overflow-hidden rounded-sm",
                  selected ? "ring-2 ring-fg" : "ring-1 ring-hairline hover:ring-fg-tertiary",
                )}
              >
                {o.value === "system" ? (
                  <span className="flex">
                    <span className="w-1/2 overflow-hidden">
                      <ThemePreview dark={false} />
                    </span>
                    <span className="w-1/2 overflow-hidden">
                      <ThemePreview dark />
                    </span>
                  </span>
                ) : (
                  <ThemePreview dark={o.value === "dark"} />
                )}
              </span>
              <span className={cn("text-footnote", selected ? "font-semibold text-fg" : "text-fg-secondary")}>
                {o.label}
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function LanguageSection() {
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const t = useT();
  // Language names stay in their own language (endonyms) in every locale.
  const options: { value: Lang; label: string }[] = [
    { value: "vi", label: "Tiếng Việt" },
    { value: "en", label: "English" },
  ];
  return (
    <Section title={t("settings.language")}>
      <div role="radiogroup" aria-label={t("settings.language")} className="flex w-fit gap-0.5 rounded-[10px] bg-hover p-[3px]">
        {options.map((o) => {
          const selected = lang === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setLang(o.value)}
              className={cn(
                "flex h-7 items-center justify-center rounded-sm px-3 text-callout font-medium transition-colors",
                selected ? "bg-control text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-fg-secondary hover:text-fg",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function DataSection() {
  const pushToast = useUi((s) => s.pushToast);
  const t = useT();
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [syncFolder, setSyncFolder] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    void syncApi.getFolder().then(setSyncFolder).catch(() => setSyncFolder(null));
  }, []);

  const chooseSyncFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked !== "string") return;
      await syncApi.setFolder(picked);
      setSyncFolder(picked);
      pushToast({ message: t("settings.syncEnabled"), durationMs: 4000 });
    } catch (e) {
      pushToast({ message: t("settings.chooseFolderError", { error: String(e) }), durationMs: 5000 });
    }
  };

  const disableSync = async () => {
    try {
      await syncApi.setFolder(null);
      setSyncFolder(null);
      pushToast({ message: t("settings.syncDisabled"), durationMs: 4000 });
    } catch (e) {
      pushToast({ message: t("settings.syncDisableError", { error: String(e) }), durationMs: 5000 });
    }
  };

  const openDataFolder = async () => {
    try {
      const { appDataDir } = await import("@tauri-apps/api/path");
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(await appDataDir());
    } catch (e) {
      pushToast({ message: t("settings.openFolderError", { error: String(e) }), durationMs: 5000 });
    }
  };

  return (
    <Section title={t("settings.data")} description={t("settings.dataDescription")}>
      <RowGroup>
        <Row label={t("settings.dataFolder")} description="%APPDATA%\com.dungnt.dntnote">
          <SecondaryButton onClick={() => void openDataFolder()} disabled={!isTauri}>
            <FolderOpen size={14} aria-hidden="true" /> {t("settings.openFolder")}
          </SecondaryButton>
        </Row>
        <Row
          label={t("settings.syncFolder")}
          description={
            syncFolder
              ? t("settings.syncingWith", { folder: syncFolder })
              : t("settings.syncDescription")
          }
        >
          <span className="flex shrink-0 gap-2">
            {syncFolder && (
              <SecondaryButton destructive onClick={() => void disableSync()}>
                {t("settings.syncDisable")}
              </SecondaryButton>
            )}
            <SecondaryButton onClick={() => void chooseSyncFolder()} disabled={!isTauri}>
              <FolderSync size={14} aria-hidden="true" /> {syncFolder ? t("settings.changeFolder") : t("settings.chooseFolder")}
            </SecondaryButton>
          </span>
        </Row>
        <Row label={t("settings.trash")} description={t("settings.trashDescription")}>
          <SecondaryButton destructive onClick={() => setConfirmTrash(true)} disabled={!isTauri}>
            <Trash2 size={14} aria-hidden="true" /> {t("settings.emptyTrash")}
          </SecondaryButton>
        </Row>
      </RowGroup>
      <ConfirmDialog
        open={confirmTrash}
        title={t("settings.emptyTrashTitle")}
        description={t("settings.emptyTrashDescription")}
        confirmLabel={t("settings.deleteForever")}
        onCancel={() => setConfirmTrash(false)}
        onConfirm={() => {
          setConfirmTrash(false);
          void api.notes
            .emptyTrash()
            .then((n) => pushToast({ message: t("settings.trashEmptied", { n }), durationMs: 4000 }))
            .catch((e) => pushToast({ message: t("settings.emptyTrashError", { error: String(e) }), durationMs: 6000 }));
        }}
      />
    </Section>
  );
}

const SHORTCUTS: [TKey, string[]][] = [
  ["settings.shortcutNewNote", ["Ctrl", "N"]],
  ["settings.shortcutNewChat", ["Ctrl", "Shift", "O"]],
  ["settings.shortcutPalette", ["Ctrl", "K"]],
  ["settings.shortcutNotesChat", ["Ctrl", "1 / 2"]],
  ["settings.shortcutChatDocked", ["Ctrl", "Shift", "J"]],
  ["settings.shortcutToggleSidebar", ["Ctrl", "\\"]],
  ["settings.shortcutSearch", ["Ctrl", "F"]],
  ["settings.shortcutSave", ["Ctrl", "S"]],
  ["settings.shortcutUndoDelete", ["Ctrl", "Z"]],
  ["settings.shortcutSettings", ["Ctrl", ","]],
];

function ShortcutsSection() {
  const t = useT();
  return (
    <Section title={t("settings.shortcuts")}>
      <RowGroup>
        {SHORTCUTS.map(([key, keys]) => (
          <Row key={key} label={t(key)}>
            <span className="flex gap-1">
              {keys.map((k) => (
                <Keycap key={k}>{k}</Keycap>
              ))}
            </span>
          </Row>
        ))}
      </RowGroup>
    </Section>
  );
}

function AboutSection() {
  const t = useT();
  return (
    <Section title={t("settings.about")}>
      <RowGroup>
        <Row label="DNT Note" description={t("settings.aboutDescription")}>
          <span className="text-footnote tabular-nums text-fg-secondary">{t("settings.version", { version: "0.1.0" })}</span>
        </Row>
        <Row label="MCP server" description={t("settings.mcpDescription")} />
      </RowGroup>
    </Section>
  );
}

type SettingsTab = "general" | "providers" | "data" | "shortcuts";

const TAB_IDS: { id: SettingsTab; labelKey: TKey }[] = [
  { id: "general", labelKey: "settings.tabGeneral" },
  { id: "providers", labelKey: "settings.tabProviders" },
  { id: "data", labelKey: "settings.tabData" },
  { id: "shortcuts", labelKey: "settings.tabShortcuts" },
];

function TabBar({ tab, onChange }: { tab: SettingsTab; onChange: (t: SettingsTab) => void }) {
  const t = useT();
  return (
    <div role="tablist" aria-label={t("settings.tablistLabel")} className="flex w-fit gap-0.5 rounded-[10px] bg-hover p-[3px]">
      {TAB_IDS.map(({ id, labelKey }) => {
        const active = tab === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`settings-tab-${id}`}
            aria-selected={active}
            aria-controls={`settings-panel-${id}`}
            onClick={() => onChange(id)}
            className={cn(
              "flex h-7 items-center justify-center gap-1.5 rounded-sm px-3 text-callout font-medium transition-colors",
              active ? "bg-control text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-fg-secondary hover:text-fg",
            )}
          >
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}

function ProvidersPanel() {
  const t = useT();
  return (
    <Section
      title={t("settings.tabProviders")}
      description={t("settings.providersDescription")}
    >
      <ProvidersSection />
    </Section>
  );
}

export function SettingsPage() {
  const loaded = useSettingsStore((s) => s.loaded);
  const loadStore = useSettingsStore((s) => s.loadStore);
  const t = useT();
  const [tab, setTab] = useState<SettingsTab>("general");

  useEffect(() => {
    if (!loaded) void loadStore();
  }, [loaded, loadStore]);

  return (
    <main aria-label={t("settings.title")} className="flex min-w-0 flex-1 flex-col bg-app">
      <ContentHeader />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-6 px-10 pb-12 pt-2">
          <h1 className="text-large-title font-bold text-fg">{t("settings.title")}</h1>
          <TabBar tab={tab} onChange={setTab} />
          <div
            role="tabpanel"
            id={`settings-panel-${tab}`}
            aria-labelledby={`settings-tab-${tab}`}
            className="flex flex-col gap-8"
          >
            {tab === "general" && (
              <>
                <AppearanceSection />
                <LanguageSection />
                <AboutSection />
              </>
            )}
            {tab === "providers" && <ProvidersPanel />}
            {tab === "data" && <DataSection />}
            {tab === "shortcuts" && <ShortcutsSection />}
          </div>
        </div>
      </div>
    </main>
  );
}
