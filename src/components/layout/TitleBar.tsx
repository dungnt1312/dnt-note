import { Minus, Square, X, Search, Settings, Sun, Moon, Monitor } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useUi } from "../../lib/store/uiStore";
import { useTheme } from "../theme/ThemeProvider";
import type { Theme } from "../theme/ThemeProvider";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function win() {
  return getCurrentWindow();
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };
  const icon =
    theme === "light" ? <Sun size={15} /> : theme === "dark" ? <Moon size={15} /> : <Monitor size={15} />;
  return (
    <button
      title={`Theme: ${theme}`}
      onClick={() => setTheme(next[theme])}
      className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
    >
      {icon}
    </button>
  );
}

export function TitleBar() {
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);

  return (
    <div
      data-tauri-drag-region
      className="h-10 flex items-center pl-3 pr-0 select-none border-b border-[var(--border)] bg-[var(--bg-panel)]"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 flex-1">
        <span className="w-4 h-4 rounded-[4px] bg-[var(--accent)] inline-block" />
        <span className="text-[13px] font-semibold text-[var(--text)]">DNT Note</span>
      </div>

      <button
        onClick={() => setPaletteOpen(true)}
        title="Tìm kiếm (Ctrl+K)"
        className="mr-2 flex items-center gap-2 px-2.5 py-1 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border)] text-[12px] text-[var(--text-faint)] hover:border-[var(--accent)]"
      >
        <Search size={13} />
        <span>Tìm kiếm</span>
        <kbd className="text-[10px] px-1 rounded bg-[var(--bg-hover)]">Ctrl K</kbd>
      </button>

      <ThemeToggle />

      <button
        onClick={() => setSettingsOpen(true)}
        title="Cài đặt"
        className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
      >
        <Settings size={15} />
      </button>

      {isTauri && (
        <div className="flex items-center h-10 ml-1">
          <button
            onClick={() => win().minimize()}
            className="w-11 h-full flex items-center justify-center hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
            title="Thu nhỏ"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={() => win().toggleMaximize()}
            className="w-11 h-full flex items-center justify-center hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
            title="Phóng to"
          >
            <Square size={12} />
          </button>
          <button
            onClick={() => win().close()}
            className="w-11 h-full flex items-center justify-center hover:bg-[var(--danger)] hover:text-white text-[var(--text-secondary)]"
            title="Đóng"
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
