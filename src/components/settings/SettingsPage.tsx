import { useEffect, useState, type ReactNode } from "react";
import { FolderOpen, FolderSync, Trash2 } from "lucide-react";
import { api } from "../../lib/api/notes";
import { syncApi } from "../../lib/api/attachments";
import { useUi } from "../../lib/store/uiStore";
import { useSettingsStore } from "../../lib/store/settingsStore";
import { isTauri } from "../../lib/env";
import { cn } from "../../lib/utils";
import { useTheme, type Theme } from "../theme/ThemeProvider";
import { ContentHeader } from "../layout/ContentHeader";
import { Keycap, SecondaryButton } from "../ui/Button";
import { ConfirmDialog } from "../ui/Dialog";
import { ProvidersSection } from "./ProvidersSection";
import { SkillsSection } from "./SkillsSection";

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
  const options: { value: Theme; label: string }[] = [
    { value: "light", label: "Sáng" },
    { value: "dark", label: "Tối" },
    { value: "system", label: "Theo hệ thống" },
  ];
  return (
    <Section title="Giao diện">
      <div role="radiogroup" aria-label="Chế độ giao diện" className="grid grid-cols-3 gap-2.5">
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

function DataSection() {
  const pushToast = useUi((s) => s.pushToast);
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
      pushToast({ message: "Đã bật đồng bộ 2 chiều", durationMs: 4000 });
    } catch (e) {
      pushToast({ message: `Không chọn được thư mục: ${e}`, durationMs: 5000 });
    }
  };

  const disableSync = async () => {
    try {
      await syncApi.setFolder(null);
      setSyncFolder(null);
      pushToast({ message: "Đã tắt đồng bộ thư mục", durationMs: 4000 });
    } catch (e) {
      pushToast({ message: `Không tắt được đồng bộ: ${e}`, durationMs: 5000 });
    }
  };

  const openDataFolder = async () => {
    try {
      const { appDataDir } = await import("@tauri-apps/api/path");
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(await appDataDir());
    } catch (e) {
      pushToast({ message: `Không mở được thư mục: ${e}`, durationMs: 5000 });
    }
  };

  return (
    <Section title="Dữ liệu" description="Mỗi ghi chú là một file .md — bạn có thể sao lưu hoặc mở bằng bất kỳ trình soạn thảo nào.">
      <RowGroup>
        <Row label="Thư mục dữ liệu" description="%APPDATA%\com.dungnt.dntnote">
          <SecondaryButton onClick={() => void openDataFolder()} disabled={!isTauri}>
            <FolderOpen size={14} aria-hidden="true" /> Mở thư mục
          </SecondaryButton>
        </Row>
        <Row
          label="Đồng bộ thư mục"
          description={
            syncFolder
              ? `Đang đồng bộ với ${syncFolder}`
              : "Mirror 2 chiều với OneDrive / Google Drive — xung đột lấy bản mới hơn."
          }
        >
          <span className="flex shrink-0 gap-2">
            {syncFolder && (
              <SecondaryButton destructive onClick={() => void disableSync()}>
                Tắt
              </SecondaryButton>
            )}
            <SecondaryButton onClick={() => void chooseSyncFolder()} disabled={!isTauri}>
              <FolderSync size={14} aria-hidden="true" /> {syncFolder ? "Đổi thư mục" : "Chọn thư mục"}
            </SecondaryButton>
          </span>
        </Row>
        <Row label="Thùng rác" description="Ghi chú đã xóa được giữ lại để có thể khôi phục.">
          <SecondaryButton destructive onClick={() => setConfirmTrash(true)} disabled={!isTauri}>
            <Trash2 size={14} aria-hidden="true" /> Dọn sạch…
          </SecondaryButton>
        </Row>
      </RowGroup>
      <ConfirmDialog
        open={confirmTrash}
        title="Dọn sạch thùng rác?"
        description="Mọi ghi chú trong thùng rác sẽ bị xóa vĩnh viễn và không thể khôi phục."
        confirmLabel="Xóa vĩnh viễn"
        onCancel={() => setConfirmTrash(false)}
        onConfirm={() => {
          setConfirmTrash(false);
          void api.notes
            .emptyTrash()
            .then((n) => pushToast({ message: `Đã xóa vĩnh viễn ${n} ghi chú`, durationMs: 4000 }))
            .catch((e) => pushToast({ message: `Không dọn được thùng rác: ${e}`, durationMs: 6000 }));
        }}
      />
    </Section>
  );
}

const SHORTCUTS: [string, string[]][] = [
  ["Ghi chú mới", ["Ctrl", "N"]],
  ["Hội thoại mới", ["Ctrl", "Shift", "O"]],
  ["Bảng lệnh", ["Ctrl", "K"]],
  ["Ghi chú / Trợ lý", ["Ctrl", "1 / 2"]],
  ["Trợ lý cạnh ghi chú", ["Ctrl", "Shift", "J"]],
  ["Ẩn/hiện thanh bên", ["Ctrl", "\\"]],
  ["Tìm ghi chú", ["Ctrl", "F"]],
  ["Lưu ngay", ["Ctrl", "S"]],
  ["Hoàn tác xóa", ["Ctrl", "Z"]],
  ["Cài đặt", ["Ctrl", ","]],
];

function ShortcutsSection() {
  return (
    <Section title="Phím tắt">
      <RowGroup>
        {SHORTCUTS.map(([label, keys]) => (
          <Row key={label} label={label}>
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
  return (
    <Section title="Giới thiệu">
      <RowGroup>
        <Row label="DNT Note" description="Ghi chú local-first, lấy cảm hứng từ NoteStudio · Rust + Tauri">
          <span className="text-footnote tabular-nums text-fg-secondary">Phiên bản 0.1.0</span>
        </Row>
        <Row label="MCP server" description="dnt-note-mcp — cho AI client bên ngoài đọc và ghi ghi chú" />
      </RowGroup>
    </Section>
  );
}

export function SettingsPage() {
  const loaded = useSettingsStore((s) => s.loaded);
  const loadStore = useSettingsStore((s) => s.loadStore);

  useEffect(() => {
    if (!loaded) void loadStore();
  }, [loaded, loadStore]);

  return (
    <main aria-label="Cài đặt" className="flex min-w-0 flex-1 flex-col bg-app">
      <ContentHeader />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-8 px-10 pb-12 pt-2">
          <h1 className="text-large-title font-bold text-fg">Cài đặt</h1>
          <AppearanceSection />
          <Section
            title="Nhà cung cấp AI"
            description="Mọi dịch vụ tương thích OpenAI (OpenAI, Ollama, OpenRouter, Groq, vLLM…). API key được lưu trong Windows Credential Manager."
          >
            <ProvidersSection />
          </Section>
          <Section
            title="Skills"
            description="Hướng dẫn chuyên biệt để trợ lý làm theo — định dạng Agent Skills (SKILL.md). Gõ / trong khung chat để dùng."
          >
            <SkillsSection />
          </Section>
          <DataSection />
          <ShortcutsSection />
          <AboutSection />
        </div>
      </div>
    </main>
  );
}
