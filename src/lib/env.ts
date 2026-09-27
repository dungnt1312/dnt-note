/** True when running inside the Tauri webview (false in plain-browser dev and tests). */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
