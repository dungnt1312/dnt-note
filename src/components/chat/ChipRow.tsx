import type { ReactNode } from "react";
import { X } from "lucide-react";

export interface Chip {
  key: string;
  icon: ReactNode;
  label: string;
  removeLabel: string;
  onRemove: () => void;
}

/** Row of removable chips (mentions, skills, files) above the composer textarea. */
export function ChipRow({ chips, children }: { chips: Chip[]; children?: ReactNode }) {
  if (chips.length === 0 && !children) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-[10px] border border-composer-border bg-control pl-2 pr-1 text-footnote text-fg"
        >
          {c.icon}
          <span className="truncate">{c.label}</span>
          <button
            type="button"
            aria-label={c.removeLabel}
            onClick={c.onRemove}
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-fg-tertiary hover:bg-hover hover:text-fg"
          >
            <X size={11} aria-hidden="true" />
          </button>
        </span>
      ))}
      {children}
    </div>
  );
}
