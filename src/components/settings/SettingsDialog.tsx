import { useState } from "react";
import { FolderOpen, Trash2, Info, X } from "lucide-react";
import { appDataDir } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { api } from "../../lib/api/notes";
import { useUi } from "../../lib/store/uiStore";
import { useTheme, type Theme } from "../theme/ThemeProvider";
import { cn } from "../../lib/utils";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Tab = "appearance" | "data" | "about";

const TABS: { id: Tab; label: string }[] = [
  { id: "appearance", label: "Giao diện" },
  { id: "data", label: "Dữ liệu" },
  { id: "about", label: "Về ứng dụng" },
];

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const options: { value: Theme; label: string; desc: string }[] = [
    { value: "light", label: "Sáng", desc: "Luôn dùng giao diện sáng" },
    { value: "dark", label: "Tối", desc: "Luôn dùng giao diện tối" },
    { value: "system", label: "Theo hệ thống", desc: "Theo cài đặt Windows" },
  ];
  return (
    <div className="flex flex-col gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => setTheme(o.value)}
          className={cn(
            "flex items-center justify-between px-4 py-3 rounded-[var(--radius-md)] border text-left",
            theme === o.value
              ? "border-[var(--accent)] bg-[var(--accent-soft)]"
              : "border-[var(--border)] hover:border-[var(--accent)]",
          )}
        >
          <div>
            <div className="text-[14px] font-medium text-[var(--text)]">{o.label}</div>
            <div className="text-[12px] text-[var(--text-secondary)]">{o.desc}</div>
          </div>
          {theme === o.value && (
            <span className="text-[12px] text-[var(--accent)] font-medium">Đang dùng</span>
          )}
        </button>
      ))}
    </div>
  );
}

function DataSection() {
  const pushToast = useUi((s) => s.pushToast);

  const openDataFolder = async () => {
    try {
      await openPath(await appDataDir());
    } catch (e) {
      pushToast({ message: `Không mở được thư mục: ${e}`, durationMs: 5000 });
    }
  };

  const emptyTrash = async () => {
    try {
      const n = await api.notes.emptyTrash();
      pushToast({ message: `Đã xóa ${n} ghi chú trong thùng rác`, durationMs: 4000 });
    } catch (e) {
      pushToast({ message: `Lỗi: ${e}`, durationMs: 5000 });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => void openDataFolder()}
        disabled={!isTauri}
        className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-md)] border border-[var(--border)] hover:border-[var(--accent)] text-left disabled:opacity-50"
      >
        <FolderOpen size={17} className="text-[var(--text-secondary)]" />
        <div>
          <div className="text-[14px] font-medium text-[var(--text)]">Mở thư mục dữ liệu</div>
          <div className="text-[12px] text-[var(--text-secondary)]">
            Ghi chú là file .md — sao chép/backup tự do
          </div>
        </div>
      </button>
      <button
        onClick={() => void emptyTrash()}
        disabled={!isTauri}
        className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-md)] border border-[var(--border)] hover:border-[var(--danger)] text-left disabled:opacity-50"
      >
        <Trash2 size={17} className="text-[var(--danger)]" />
        <div>
          <div className="text-[14px] font-medium text-[var(--text)]">Xóa sạch thùng rác</div>
          <div className="text-[12px] text-[var(--text-secondary)]">
            Xóa vĩnh viễn mọi ghi chú đã xóa
          </div>
        </div>
      </button>
    </div>
  );
}

function AboutSection() {
  return (
    <div className="flex flex-col gap-3 text-[13px] text-[var(--text-secondary)]">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-[12px] bg-[var(--accent)] inline-block" />
        <div>
          <div className="text-[16px] font-semibold text-[var(--text)]">DNT Note</div>
          <div className="text-[12px] text-[var(--text-faint)]">Phiên bản 0.1.0 · Phase 1</div>
        </div>
      </div>
      <p>
        Ghi chú local-first lưu thành file Markdown, lấy cảm hứng từ{" "}
        <span className="text-[var(--text)]">NoteStudio</span>, xây bằng Rust + Tauri.
      </p>
      <p className="flex items-center gap-2 text-[12px] text-[var(--text-faint)]">
        <Info size={13} /> AI assistant + MCP server sẽ có ở các giai đoạn tiếp theo.
      </p>
    </div>
  );
}

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  const setOpen = useUi((s) => s.setSettingsOpen);
  const [tab, setTab] = useState<Tab>("appearance");

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="w-[520px] max-w-[92vw] rounded-[var(--radius-lg)] bg-[var(--bg-elevated)] border border-[var(--border)] shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-[16px] font-semibold text-[var(--text)]">Cài đặt</h2>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
            title="Đóng (Esc)"
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex gap-1 px-4 pt-3 border-b border-[var(--border)]">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-3 py-2 text-[13px] border-b-2 -mb-px",
                tab === t.id
                  ? "border-[var(--accent)] text-[var(--text)] font-medium"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text)]",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          {tab === "appearance" && <AppearanceSection />}
          {tab === "data" && <DataSection />}
          {tab === "about" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}
