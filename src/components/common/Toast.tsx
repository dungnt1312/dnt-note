import { X } from "lucide-react";
import { useUi } from "../../lib/store/uiStore";

/** Single capsule toast at the bottom centre (Studio style), e.g. "Đã xóa · Hoàn tác". */
export function Toast() {
  const toast = useUi((s) => s.toasts[s.toasts.length - 1]);
  const dismissToast = useUi((s) => s.dismissToast);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center">
      {toast && (
        <div
          key={toast.id}
          role="status"
          className="pointer-events-auto flex h-10 max-w-[min(560px,calc(100vw-48px))] items-center gap-3.5 rounded-full bg-accent pl-[18px] pr-3 text-accent-fg shadow-[0_6px_14px_rgba(0,0,0,0.18)]"
        >
          <span className="truncate text-callout font-medium">{toast.message}</span>
          {toast.actionLabel && (
            <button
              type="button"
              onClick={() => {
                toast.onAction?.();
                dismissToast(toast.id);
              }}
              className="flex shrink-0 items-center gap-1.5 text-callout font-semibold hover:opacity-80"
            >
              {toast.actionLabel}
              <span className="opacity-60">Ctrl Z</span>
            </button>
          )}
          <button
            type="button"
            aria-label="Đóng thông báo"
            onClick={() => dismissToast(toast.id)}
            className="flex size-6 shrink-0 items-center justify-center rounded-full opacity-60 hover:opacity-100"
          >
            <X size={12} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
