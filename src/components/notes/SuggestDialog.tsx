import { useEffect, useState } from "react";
import { suggestTitleAndTags, type Suggestion } from "../../lib/agent/suggest";
import { useNotesStore } from "../../lib/store/notesStore";
import { useSettingsStore } from "../../lib/store/settingsStore";
import { useUi } from "../../lib/store/uiStore";
import { cn, errMsg } from "../../lib/utils";
import { Overlay } from "../ui/Dialog";
import { PillButton, SecondaryButton } from "../ui/Button";

interface Props {
  noteId: string;
  title: string;
  body: string;
  tags: string[];
  onClose: () => void;
}

export function SuggestDialog({ noteId, title, body, tags, onClose }: Props) {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const pushToast = useUi((s) => s.pushToast);

  useEffect(() => {
    const provider = useSettingsStore.getState().activeProvider();
    if (!provider) {
      setError("Chưa cấu hình provider AI — mở Cài đặt → Nhà cung cấp AI.");
      return;
    }
    const ctrl = new AbortController();
    const existing = useNotesStore.getState().tags.map((t) => t.name);
    suggestTitleAndTags({ provider, title, body, existingTags: existing, signal: ctrl.signal })
      .then((s) => {
        setSuggestion(s);
        setNewTitle(s.title);
        setPicked(s.tags);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(errMsg(e));
      });
    return () => ctrl.abort();
    // Run once per open; inputs are a snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (t: string) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const apply = async () => {
    setBusy(true);
    try {
      const store = useNotesStore.getState();
      const t = newTitle.trim();
      if (t && t !== title) await store.setTitle(noteId, t);
      const merged = [...tags, ...picked.filter((p) => !tags.includes(p))];
      if (merged.length !== tags.length) await store.setTags(noteId, merged);
      pushToast({ message: "Đã áp dụng gợi ý", durationMs: 3000 });
      onClose();
    } catch (e) {
      pushToast({ message: errMsg(e), durationMs: 4000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay open onClose={onClose} label="Gợi ý tiêu đề & thẻ" className="flex w-[480px] flex-col">
      <div className="border-b border-hairline px-5 py-3">
        <h2 className="text-headline font-semibold text-fg">Gợi ý tiêu đề & thẻ</h2>
      </div>
      <div className="space-y-4 px-5 py-4 text-callout">
        {!suggestion && !error && <p className="text-fg-secondary">Đang hỏi AI…</p>}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {suggestion && (
          <>
            <div>
              <div className="mb-1 text-footnote text-fg-secondary">Hiện tại: {title || "Chưa đặt tên"}</div>
              <input
                data-autofocus
                aria-label="Tiêu đề gợi ý"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full rounded-sm border border-hairline bg-transparent px-2.5 py-1.5 text-fg"
              />
            </div>
            <div>
              <div className="mb-1 text-footnote text-fg-secondary">Thẻ gợi ý (bấm để chọn/bỏ)</div>
              <div className="flex flex-wrap gap-1.5">
                {suggestion.tags.length === 0 && <span className="text-fg-secondary">Không có thẻ</span>}
                {suggestion.tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={picked.includes(t)}
                    onClick={() => toggle(t)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-footnote transition-colors",
                      picked.includes(t)
                        ? "border-accent bg-selected text-fg"
                        : "border-hairline text-fg-secondary line-through",
                    )}
                  >
                    #{t}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3">
        <SecondaryButton onClick={onClose}>Hủy</SecondaryButton>
        <PillButton tone="accent" className="h-8 px-3.5" disabled={!suggestion || busy} onClick={() => void apply()}>
          Áp dụng
        </PillButton>
      </div>
    </Overlay>
  );
}
