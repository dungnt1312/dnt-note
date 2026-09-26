import { Undo2, X } from "lucide-react";
import { useUi } from "../../lib/store/uiStore";

export function UndoToast() {
  const toasts = useUi((s) => s.toasts);
  const dismissToast = useUi((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-3 px-4 py-2.5 rounded-[var(--radius-md)] bg-[var(--bg-elevated)] border border-[var(--border)] shadow-lg text-[13px]"
        >
          <span className="text-[var(--text)]">{t.message}</span>
          {t.actionLabel && (
            <button
              onClick={() => {
                t.onAction?.();
                dismissToast(t.id);
              }}
              className="flex items-center gap-1 text-[var(--accent)] font-medium hover:opacity-80"
            >
              <Undo2 size={13} /> {t.actionLabel}
            </button>
          )}
          <button
            onClick={() => dismissToast(t.id)}
            className="text-[var(--text-faint)] hover:text-[var(--text)]"
            title="Đóng"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
