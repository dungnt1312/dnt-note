/** Supported UI languages. First rollout: Vietnamese + English. */
export type Lang = "vi" | "en";

/**
 * Define one area's dictionary with compile-time key parity: `vi` must contain
 * every key `en` has. Area files call this once and export the result, e.g.
 *   export const sidebarDict = defineDict({ en: { "sidebar.new": "New note" }, vi: { "sidebar.new": "Ghi chú mới" } });
 */
export function defineDict<D extends Record<string, string>>(d: {
  en: D;
  vi: Record<keyof D, string>;
}): { en: D; vi: Record<keyof D, string> } {
  return d;
}
