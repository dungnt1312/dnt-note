import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { api } from "./lib/api/notes";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Tiny always-on-top capture window (Ctrl+Shift+N). Enter saves, Esc hides. */
export default function QuickCapture() {
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
    <div className="h-screen flex flex-col bg-[var(--bg-elevated)] border border-[var(--accent)]/60 rounded-[var(--radius-md)] overflow-hidden">
      <div className="px-3 pt-2 text-[11px] text-[var(--text-faint)] flex justify-between">
        <span>Quick capture — Enter để lưu, Esc để ẩn</span>
        <span data-tauri-drag-region className="cursor-move">DNT Note</span>
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
        placeholder="Ghi nhanh điều bạn đang nghĩ…"
        className="flex-1 resize-none bg-transparent outline-none px-3 py-2 text-[14px] text-[var(--text)] placeholder:text-[var(--text-faint)]"
      />
      <div className="px-3 pb-2 text-[10px] text-[var(--text-faint)]">
        {saving ? "Đang lưu…" : "Lưu vào ghi chú mới với tag 'quick'"}
      </div>
    </div>
  );
}
