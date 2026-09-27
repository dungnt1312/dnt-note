import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { PillButton, SecondaryButton } from "./Button";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  placement?: "center" | "top";
  className?: string;
  children: ReactNode;
}

/** Modal shell: dimmed backdrop, Esc/backdrop to close, focus trapped and restored. */
export function Overlay({ open, onClose, label, placement = "center", className, children }: OverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) {
        (panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel.querySelector<HTMLElement>(FOCUSABLE))?.focus();
      }
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === "Tab" && panelRef.current) {
        const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-center overscroll-contain bg-black/30 dark:bg-black/50",
        placement === "center" ? "items-center" : "items-start pt-[110px]",
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          "max-w-[calc(100vw-48px)] overflow-hidden rounded-[14px] border border-composer-border bg-popover shadow-popover",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation for destructive actions ("Delete…?"). */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Hủy",
  destructive = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const descId = useId();
  return (
    <Overlay open={open} onClose={onCancel} label={title} className="w-[400px]">
      <div className="p-5" aria-describedby={description ? descId : undefined}>
        <h2 className="text-headline font-semibold text-fg">{title}</h2>
        {description && (
          <p id={descId} className="mt-1.5 text-callout text-fg-secondary">
            {description}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <SecondaryButton onClick={onCancel} data-autofocus>
            {cancelLabel}
          </SecondaryButton>
          <PillButton
            tone={destructive ? "danger" : "accent"}
            className="h-8 px-3.5"
            onClick={() => {
              onConfirm();
            }}
          >
            {confirmLabel}
          </PillButton>
        </div>
      </div>
    </Overlay>
  );
}
