import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MENU_ITEMS, MenuContext } from "./Menu";

interface ContextMenuProps {
  /** Viewport coordinates of the right-click. */
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Cursor-anchored menu: like Menu (Esc/click-outside/arrow keys, shared
 * MenuItem components) but rendered in a portal at fixed coordinates —
 * there is no trigger element to anchor to.
 */
export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // The menu size is only known after the first paint — clamp it into the viewport once.
  useLayoutEffect(() => {
    const r = listRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos((p) => ({
      x: Math.max(8, Math.min(p.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(p.y, window.innerHeight - r.height - 8)),
    }));
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!listRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(MENU_ITEMS)?.focus());
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>(MENU_ITEMS) ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return createPortal(
    <MenuContext.Provider value={{ close: onClose }}>
      <div
        ref={listRef}
        role="menu"
        onKeyDown={onListKey}
        style={{ left: pos.x, top: pos.y, width: 232 }}
        className="fixed z-50 max-h-[min(440px,calc(100vh-16px))] overflow-y-auto rounded-md border border-composer-border bg-popover p-1.5 shadow-popover"
      >
        {children}
      </div>
    </MenuContext.Provider>,
    document.body,
  );
}
