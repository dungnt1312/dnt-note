import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";

type NativeButton = ButtonHTMLAttributes<HTMLButtonElement>;

interface IconButtonProps extends Omit<NativeButton, "aria-label"> {
  /** Accessible name — also shown as the native tooltip. */
  label: string;
  active?: boolean;
  size?: "sm" | "md";
  children: ReactNode;
}

/** Square icon button for headers and toolbars (32px, or 28px when `sm`). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active = false, size = "md", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-sm transition-colors",
        "hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40",
        size === "md" ? "size-8" : "size-7",
        active ? "bg-hover text-fg" : "text-fg-secondary",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

interface PillButtonProps extends NativeButton {
  tone?: "accent" | "danger";
}

/** Primary action — filled capsule (black in light mode, white in dark mode). */
export function PillButton({ tone = "accent", className, type = "button", ...rest }: PillButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-4 text-callout font-semibold transition-colors",
        "disabled:pointer-events-none disabled:opacity-40",
        tone === "accent"
          ? "bg-accent text-accent-fg hover:bg-accent-hover"
          : "bg-danger text-white hover:opacity-90",
        className,
      )}
      {...rest}
    />
  );
}

interface SecondaryButtonProps extends NativeButton {
  destructive?: boolean;
}

/** Secondary action — outlined capsule on the control background. */
export function SecondaryButton({
  destructive = false,
  className,
  type = "button",
  ...rest
}: SecondaryButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-full border bg-control px-3.5 text-callout font-medium transition-colors",
        "hover:bg-hover disabled:pointer-events-none disabled:opacity-40",
        destructive ? "border-danger-border text-danger" : "border-hairline text-fg",
        className,
      )}
      {...rest}
    />
  );
}

/** Small keycap used to show shortcuts. */
export function Keycap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-hairline bg-subtle px-1",
        "font-sans text-caption font-medium text-fg-tertiary",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Vertical hairline separator for toolbars. */
export function ToolbarDivider() {
  return <span aria-hidden="true" className="mx-1.5 h-4 w-px shrink-0 bg-hairline" />;
}
