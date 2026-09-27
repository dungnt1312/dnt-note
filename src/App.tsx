import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./lib/api/notes";
import { ThemeProvider } from "./components/theme/ThemeProvider";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { NoteEditor } from "./components/notes/NoteEditor";
import { CommandPalette } from "./components/layout/CommandPalette";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { ChatPanel } from "./components/chat/ChatPanel";
import { ensureLlmFetch } from "./components/settings/ProvidersSection";
import { UndoToast } from "./components/common/UndoToast";
import { useNotesStore } from "./lib/store/notesStore";
import { useSettingsStore } from "./lib/store/settingsStore";
import { useUi } from "./lib/store/uiStore";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function useDeepLinkAndSync() {
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen<string>("deep-link://url", (event) => {
      // dntnote://note/<id>
      const m = /dntnote:\/\/note\/([\w-]+)/.exec(event.payload ?? "");
      if (m) void useNotesStore.getState().select(m[1]);
    });
    const unlistenSync = listen<{ copiedOut: number; copiedIn: number; resolved: number }>(
      "sync://status",
      (event) => {
        const r = event.payload;
        if (!r) return;
        useUi.getState().pushToast({
          message: `Đồng bộ: ↗${r.copiedOut} ↙${r.copiedIn} ✓${r.resolved}`,
          durationMs: 4000,
        });
      },
    );
    return () => {
      void unlisten.then((f) => f());
      void unlistenSync.then((f) => f());
    };
  }, []);
}

function useNoteEvents() {
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen<string[]>("notes://changed", (event) => {
      const ids = event.payload ?? [];
      void useNotesStore.getState().load();
      // If the open note changed on disk and nothing is unsaved locally,
      // pull in the external edit (MCP / cloud folder) live.
      const { selectedId: sel, saveState: st } = useNotesStore.getState();
      if (sel && ids.includes(sel) && st === "saved") {
        void api.notes
          .read(sel)
          .then((n) => {
            const cur = useNotesStore.getState();
            if (cur.selectedId === sel && cur.saveState === "saved") {
              useNotesStore.setState({ body: n.body });
            }
          })
          .catch(() => {});
      }
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);
}

export default function App() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  );
}

function Shell() {
  const load = useNotesStore((s) => s.load);
  const create = useNotesStore((s) => s.create);
  const flushSave = useNotesStore((s) => s.flushSave);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const paletteOpen = useUi((s) => s.paletteOpen);
  useNoteEvents();
  useDeepLinkAndSync();

  useEffect(() => {
    void load();
    void ensureLlmFetch();
    void useSettingsStore.getState().loadStore();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const ui = useUi.getState();
        if (ui.settingsOpen) ui.setSettingsOpen(false);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        const toasts = useUi.getState().toasts;
        const undoable = [...toasts].reverse().find((t) => t.onAction);
        if (undoable) {
          e.preventDefault();
          undoable.onAction?.();
          useUi.getState().dismissToast(undoable.id);
        }
        return;
      }
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "n") {
        e.preventDefault();
        void create();
      } else if (key === "k" || key === "p") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      } else if (key === "f") {
        e.preventDefault();
        document.getElementById("note-search")?.focus();
      } else if (key === "s") {
        e.preventDefault();
        void flushSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [create, flushSave, setPaletteOpen, paletteOpen]);

  return (
    <div className="h-screen flex flex-col">
      <TitleBar />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <NoteEditor />
        <ChatPanel />
      </div>
      <CommandPalette />
      <SettingsDialog />
      <UndoToast />
    </div>
  );
}
