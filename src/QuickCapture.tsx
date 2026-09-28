import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { api } from "./lib/api/notes";
import { BrandMark } from "./components/common/BrandMark";
import { useT } from "./lib/i18n";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Tiny always-on-top capture window (Ctrl+Shift+N). Enter saves, Esc hides. */
export default function QuickCapture() {
  const t = useT();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const hide = () => {
    if (isTauri) void getCurrentWindow().hide();
    setText("");
  };

  const save = async () => {
    const content = text.trim();
    if (!content || saving) return;
    setSaving(true);
    try {
      const firstLine = content.split("\n")[0].slice(0, 80) || "Quick note";
      const body = content.split("\n").length > 1 ? content : "";
      await api.notes.create(firstLine, body, ["quick"]);
      if (isTauri) {
        const { emit } = await import("@tauri-apps/api/event");
        await emit("notes://created", null);
      }
    } finally {
      setSaving(false);
      hide();
    }
  };

  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen("quickcapture://shown", () => {
      setText("");
      inputRef.current?.focus();
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  return (
    <div className="box-border flex h-screen w-screen flex-col overflow-hidden rounded-md border border-composer-border bg-popover">
      <div data-tauri-drag-region className="flex cursor-move items-center justify-between px-4 pt-3 text-footnote">
        <span data-tauri-drag-region className="font-semibold text-fg">
          {t("app.quickTitle")}
        </span>
        <span data-tauri-drag-region className="flex items-center gap-1.5 text-fg-tertiary">
          <BrandMark size={14} />
          DNT Note
        </span>
      </div>
      <textarea
        ref={inputRef}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            hide();
          }
        }}
        placeholder={t("app.quickPlaceholder")}
        aria-label={t("app.quickInputLabel")}
        className="flex-1 resize-none bg-transparent px-4 py-2 text-body text-fg outline-none"
      />
      <div aria-live="polite" className="flex items-center gap-3 px-4 pb-3 text-caption text-fg-tertiary">
        {saving ? (
          t("app.quickSaving")
        ) : (
          <>
            <span>
              <kbd className="font-sans font-medium">Enter</kbd> {t("app.quickSaveHint")}
            </span>
            <span>
              <kbd className="font-sans font-medium">Esc</kbd> {t("app.quickHideHint")}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
