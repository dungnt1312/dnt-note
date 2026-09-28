import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./lib/api/notes";
import { isTauri } from "./lib/env";
import { ThemeProvider } from "./components/theme/ThemeProvider";
import { Sidebar } from "./components/layout/Sidebar";
import { NoteEditor } from "./components/notes/NoteEditor";
import { CommandPalette } from "./components/layout/CommandPalette";
import { SettingsPage } from "./components/settings/SettingsPage";
import { ChatPanel } from "./components/chat/ChatPanel";
import { ensureLlmFetch } from "./components/settings/ProvidersSection";
import { Toast } from "./components/common/Toast";
import { useNotesStore } from "./lib/store/notesStore";
import { useChatStore } from "./lib/store/chatStore";
import { useSettingsStore } from "./lib/store/settingsStore";
import { useUi } from "./lib/store/uiStore";
import { getT } from "./lib/i18n";
import { openNoteById } from "./lib/openNote";

function useDeepLinkAndSync() {
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen<string>("deep-link://url", (event) => {
      // dntnote://note/<id>
      const m = /dntnote:\/\/note\/([\w-]+)/.exec(event.payload ?? "");
      if (m) void openNoteById(m[1]);
    });
    const unlistenSync = listen<{ copiedOut: number; copiedIn: number; resolved: number }>(
      "sync://status",
      (event) => {
        const r = event.payload;
        if (!r) return;
        useUi.getState().pushToast({
          message: getT()("app.syncToast", { out: r.copiedOut, in: r.copiedIn, resolved: r.resolved }),
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

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (e.key === "Escape") {
        if (ui.section === "settings" && !ui.paletteOpen) ui.setSettingsOpen(false);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      if (key === "z" && !e.shiftKey) {
        // Only hijack Ctrl+Z for an undoable toast when focus is not in a text field.
        const target = e.target as HTMLElement | null;
        const editing = target?.closest("input, textarea, .cm-editor");
        const undoable = ui.toasts.find((t) => t.onAction);
        if (undoable && !editing) {
          e.preventDefault();
          undoable.onAction?.();
          ui.dismissToast(undoable.id);
        }
        return;
      }

      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (e.shiftKey && key === "o") return run(() => {
        void useChatStore.getState().newChat();
        ui.setSection("chat");
      });
      if (e.shiftKey && key === "j") return run(() => {
        if (ui.section !== "notes") ui.setSection("notes");
        ui.setChatOpen(!(ui.section === "notes" && ui.chatOpen));
      });
      if (e.shiftKey) return;
      if (key === "n") return run(() => {
        ui.setSection("notes");
        void useNotesStore.getState().create();
      });
      if (key === "k" || key === "p") return run(() => ui.setPaletteOpen(!ui.paletteOpen));
      if (key === "1") return run(() => ui.setSection("notes"));
      if (key === "2") return run(() => ui.setSection("chat"));
      if (key === ",") return run(() => ui.setSettingsOpen(ui.section !== "settings"));
      if (key === "\\") return run(ui.toggleSidebar);
      if (key === "f") return run(() => {
        ui.setSection("notes");
        if (!ui.sidebarVisible) ui.toggleSidebar();
        requestAnimationFrame(() => document.getElementById("note-search")?.focus());
      });
      if (key === "s") return run(() => void useNotesStore.getState().flushSave());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
  const section = useUi((s) => s.section);
  const chatOpen = useUi((s) => s.chatOpen);
  useNoteEvents();
  useDeepLinkAndSync();
  useShortcuts();

  useEffect(() => {
    void load();
    void ensureLlmFetch();
    void useSettingsStore.getState().loadStore();
  }, [load]);

  return (
    <div className="flex h-screen min-h-0 bg-app text-fg">
      <Sidebar />
      {section === "notes" && (
        <>
          <NoteEditor />
          {chatOpen && <ChatPanel variant="side" />}
        </>
      )}
      {section === "chat" && <ChatPanel variant="full" />}
      {section === "settings" && <SettingsPage />}
      <CommandPalette />
      <Toast />
    </div>
  );
}
