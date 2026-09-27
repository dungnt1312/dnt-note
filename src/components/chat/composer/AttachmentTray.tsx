import { FileText, ImageIcon, Loader2, X } from "lucide-react";
import type { DraftAttachment } from "../../../lib/store/composerStore";

export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Attachment cards inside the composer: preview/status/remove. */
export function AttachmentTray({ items, onRemove }: { items: DraftAttachment[]; onRemove: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
      {items.map((a) => (
        <div
          key={a.id}
          role="listitem"
          aria-label={a.originalName}
          className="relative flex w-[190px] items-center gap-2 rounded-[11px] border border-composer-border bg-control p-1.5 pr-6"
        >
          {a.status === "importing" ? (
            <span className="flex size-8 items-center justify-center">
              <Loader2 size={14} aria-hidden="true" className="animate-spin text-fg-secondary" />
            </span>
          ) : a.kind === "image" && a.previewUrl ? (
            <img src={a.previewUrl} alt="" className="size-8 rounded-md object-cover" />
          ) : (
            <span className="flex size-8 items-center justify-center rounded-md bg-subtle text-fg-secondary">
              {a.kind === "image" ? <ImageIcon size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-footnote text-fg">{a.originalName}</span>
            <span className="block truncate text-caption text-fg-tertiary">
              {a.status === "error"
                ? a.error
                : a.status === "importing"
                  ? "Đang thêm…"
                  : `${a.kind === "image" ? "Ảnh" : "Tài liệu"} · ${fmtSize(a.size)}`}
            </span>
          </span>
          <button
            type="button"
            aria-label={`Bỏ ${a.originalName}`}
            onClick={() => onRemove(a.id)}
            className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full text-fg-tertiary hover:bg-hover hover:text-fg"
          >
            <X size={11} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
