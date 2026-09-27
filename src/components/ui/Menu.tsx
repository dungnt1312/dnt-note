import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";

export const MenuContext = createContext<{ close: () => void }>({ close: () => {} });

export const MENU_ITEMS = "[role^=menuitem]:not([disabled])";

interface MenuProps {
  /** Renders the trigger; spread `props` onto a button. */
  trigger: (props: {
    onClick: () => void;
    "aria-expanded": boolean;
    "aria-haspopup": "menu";
    "aria-controls": string;
  }) => ReactNode;
  align?: "start" | "end";
  side?: "bottom" | "top";
  width?: number;
  children: ReactNode;
}

/** Lightweight popover menu: click-outside/Esc to close, ↑↓ to move between items. */
export function Menu({ trigger, align = "end", side = "bottom", width = 232, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => {
      const list = listRef.current;
      (list?.querySelector<HTMLElement>(`${MENU_ITEMS}[aria-checked=true]`) ?? list?.querySelector<HTMLElement>(MENU_ITEMS))?.focus();
    });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>(MENU_ITEMS) ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div ref={rootRef} className="pointer-events-auto relative">
      {trigger({
        onClick: () => setOpen((o) => !o),
        "aria-expanded": open,
        "aria-haspopup": "menu",
        "aria-controls": id,
      })}
      {open && (
        <MenuContext.Provider value={{ close: () => setOpen(false) }}>
          <div
            id={id}
            ref={listRef}
            role="menu"
            onKeyDown={onListKey}
            style={{ width }}
            className={cn(
              "absolute z-40 max-h-[min(440px,calc(100vh-96px))] overflow-y-auto rounded-md border border-composer-border bg-popover p-1.5 shadow-popover",
              align === "end" ? "right-0" : "left-0",
              side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
            )}
          >
            {children}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  );
}

interface MenuItemProps {
  icon?: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  /** Set to make this one choice of a radio set (e.g. the current model). */
  checked?: boolean;
  title?: string;
  onSelect: () => void;
}

export function MenuItem({ icon, children, hint, destructive, disabled, checked, title, onSelect }: MenuItemProps) {
  const { close } = useContext(MenuContext);
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      title={title}
      disabled={disabled}
      onClick={() => {
        close();
        onSelect();
      }}
      className={cn(
        "flex h-8 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-callout outline-none",
        "hover:bg-hover focus-visible:bg-hover disabled:opacity-40",
        destructive ? "text-danger" : "text-fg",
      )}
    >
      {icon && (
        <span aria-hidden="true" className={cn("flex w-4 justify-center", !destructive && "text-fg-secondary")}>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-footnote text-fg-tertiary">{hint}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="mx-1 my-1 h-px bg-hairline" />;
}

export function MenuLabel({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div id={id} className="px-2.5 pb-1 pt-1.5 text-caption text-fg-tertiary">
      {children}
    </div>
  );
}

/** Labelled set of items, e.g. the models of one provider. */
export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id}>
      <MenuLabel id={id}>{label}</MenuLabel>
      {children}
    </div>
  );
}
