import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./lib/api/notes";
import { ThemeProvider } from "./components/theme/ThemeProvider";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { NoteEditor } from "./components/notes/NoteEditor";
import { CommandPalette } from "./components/layout/CommandPalette";
import { UndoToast } from "./components/common/UndoToast";
import { useNotesStore } from "./lib/store/notesStore";
import { useUi } from "./lib/store/uiStore";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
        {/* Chat panel — Phase 2 */}
      </div>
      <CommandPalette />
      <UndoToast />
    </div>
  );
}
