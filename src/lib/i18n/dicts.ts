import { sidebarDict } from "../../i18n/sidebar";
import { notesDict } from "../../i18n/notes";
import { chatDict } from "../../i18n/chat";
import { settingsDict } from "../../i18n/settings";
import { appDict } from "../../i18n/app";
import { agentDict } from "../../i18n/agent";
import type { Lang } from "./defineDict";

const areas = [sidebarDict, notesDict, chatDict, settingsDict, appDict, agentDict];

function merge(lang: Lang): Record<string, string> {
  return Object.assign({}, ...areas.map((a) => a[lang]));
}

/**
 * Union of every area's `en` keys, spelled out per-area: an empty area dict
 * (`en: {}`) inside the array would otherwise collapse the key union to `never`.
 */
type EnKeys<D> = D extends { en: infer E } ? keyof E : never;
export type DictKey =
  | EnKeys<typeof sidebarDict>
  | EnKeys<typeof notesDict>
  | EnKeys<typeof chatDict>
  | EnKeys<typeof settingsDict>
  | EnKeys<typeof appDict>
  | EnKeys<typeof agentDict>;

const dicts = {
  en: merge("en"),
  vi: merge("vi"),
} as Record<Lang, Record<DictKey, string>>;

/**
 * Translate `key` for `lang`, substituting `{name}` placeholders from `vars`.
 * Falls back to Vietnamese, then to the key itself, so a missing translation can never crash.
 */
export function translate(lang: Lang, key: DictKey, vars?: Record<string, string | number>): string {
  let s: string = dicts[lang][key] ?? dicts.vi[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}
