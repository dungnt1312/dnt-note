import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/** Section label inside the sidebar list ("Đã ghim", "Hôm nay"…). */
export function SidebarSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" className="px-2.5 pb-1 pt-3.5 text-footnote font-semibold text-fg-secondary">
      {children}
    </div>
  );
}

interface SidebarRowProps {
  selected: boolean;
  onSelect: () => void;
  /** Hover-revealed trailing actions; rendered outside the select button. */
  actions?: ReactNode;
  label?: string;
  children: ReactNode;
  onContextMenu?: (e: React.MouseEvent) => void;
}

/** Selectable list row: rounded, grey hover/selected fill, trailing hover actions. */
export function SidebarRow({ selected, onSelect, actions, label, children, onContextMenu }: SidebarRowProps) {
  return (
    <div
      className={cn(
        "group relative flex items-center rounded-sm transition-colors",
        selected ? "bg-selected" : "hover:bg-hover",
      )}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        aria-label={label}
        className="min-w-0 flex-1 rounded-sm px-2.5 py-1.5 text-left"
      >
        {children}
      </button>
      {actions && (
        <div
          className={cn(
            // No transform here: it would create a stacking context and trap the
            // menu's z-40, letting later rows paint over the open menu.
            "pointer-events-none absolute inset-y-0 right-1 flex items-center",
            "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
            selected && "opacity-100",
          )}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
