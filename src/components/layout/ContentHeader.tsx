import type { ReactNode } from "react";
import { useUi } from "../../lib/store/uiStore";
import { cn } from "../../lib/utils";
import { WindowControls } from "../ui/WindowControls";
import { SidebarControls } from "./Sidebar";

interface ContentHeaderProps {
  /** Left side content (breadcrumb, model picker…). */
  leading?: ReactNode;
  /** Right side actions. */
  trailing?: ReactNode;
  /** Render the Windows caption buttons (only the right-most header does). */
  windowControls?: boolean;
  className?: string;
}

/** 52px draggable header shared by the editor, assistant and settings. */
export function ContentHeader({ leading, trailing, windowControls = true, className }: ContentHeaderProps) {
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  return (
    <header
      data-tauri-drag-region
      className={cn("flex h-[52px] shrink-0 items-center gap-1 pl-3 pr-3", className)}
    >
      {!sidebarVisible && <SidebarControls />}
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-1">
        {leading}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-1">{trailing}</div>}
      {windowControls && <WindowControls />}
    </header>
  );
}
