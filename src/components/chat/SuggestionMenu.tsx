import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface SuggestionItem {
  key: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
}

/** Listbox shown above the composer for @mention / slash-skill suggestions. */
export function SuggestionMenu({
  id,
  label,
  heading,
  items,
  cursor,
  onHover,
  onPick,
}: {
  id: string;
  label: string;
  heading: string;
  items: SuggestionItem[];
  cursor: number;
  onHover: (i: number) => void;
  onPick: (i: number) => void;
}) {
  return (
    <div
      role="listbox"
      id={id}
      aria-label={label}
      className="absolute bottom-full left-0 right-0 mb-2 max-h-[300px] overflow-y-auto rounded-[16px] border border-composer-border bg-popover p-1.5 shadow-popover"
    >
      <div className="px-2.5 pb-1 pt-1 text-caption font-medium text-fg-secondary">{heading}</div>
      {items.map((it, i) => (
        <button
          key={it.key}
          type="button"
          role="option"
          aria-selected={i === cursor}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(i)}
          className={cn("flex h-11 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left", i === cursor && "bg-hover")}
        >
          {it.icon}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-callout font-medium text-fg">{it.title}</span>
            <span className="block truncate text-caption text-fg-secondary">{it.subtitle}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
