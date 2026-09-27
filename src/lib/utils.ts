import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Studio type scale from tokens.css — without this, tailwind-merge treats
// `text-caption` etc. as colors and drops them next to `text-fg`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["caption", "footnote", "callout", "body", "headline", "title", "large-title"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Human-readable message from a thrown value (Tauri commands reject with strings). */
export function errMsg(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}
