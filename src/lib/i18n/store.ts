import { create } from "zustand";
import { translate } from "./dicts";
import type { Lang } from "./defineDict";

const STORAGE_KEY = "dnt-lang";

function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "vi" || stored === "en") return stored;
  } catch {
    /* localStorage unavailable — fall through to system detection */
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("vi") ? "vi" : "en";
}

function apply(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore persistence failures */
  }
  // Guarded: this module also loads in non-DOM test environments.
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const useLangStore = create<LangState>()((set) => {
  const initial = detectLang();
  apply(initial);
  return {
    lang: initial,
    setLang: (lang) => {
      apply(lang);
      set({ lang });
    },
  };
});

/** Translate bound to the live language — reactive for components. */
export function useT() {
  const lang = useLangStore((s) => s.lang);
  return (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
}

/** Translate in non-React code (lib/engine); reads the language at call time. */
export function getT() {
  return (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
    translate(useLangStore.getState().lang, key, vars);
}

/** BCP-47 tag for number/date formatting matching the current UI language. */
export function localeTag(): string {
  return useLangStore.getState().lang === "en" ? "en-US" : "vi-VN";
}

export type { Lang };
