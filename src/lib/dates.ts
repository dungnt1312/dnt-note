import { getT, useLangStore, type Lang } from "./i18n";

export type TimeBucket = "today" | "yesterday" | "week" | "month" | "older";

const BUCKET_ORDER: TimeBucket[] = ["today", "yesterday", "week", "month", "older"];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days between `date` and `now` (0 = same day). */
function daysAgo(date: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
}

export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function timeBucket(value: Date | string, now = new Date()): TimeBucket {
  const days = daysAgo(toDate(value), now);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "week";
  if (days < 30) return "month";
  return "older";
}

/**
 * ChatGPT-style sections: today / yesterday / last 7 days / last 30 days / older.
 * `key` is the stable bucket id; `label` is resolved through the i18n dict for
 * non-React callers. React callers should translate `key` with useT() so the
 * label re-renders on language change.
 */
export function groupByTime<T>(
  items: T[],
  getDate: (item: T) => Date | string,
  now = new Date(),
): { key: TimeBucket; label: string; items: T[] }[] {
  const buckets = new Map<TimeBucket, T[]>();
  for (const item of items) {
    const key = timeBucket(getDate(item), now);
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  }
  return BUCKET_ORDER.filter((k) => buckets.has(k)).map((key) => ({
    key,
    label: getT()(`sidebar.group.${key}`),
    items: buckets.get(key)!,
  }));
}

/** Per-locale formatters; picked by the live UI language. */
const FMT: Record<Lang, { time: Intl.DateTimeFormat; weekday: Intl.DateTimeFormat; dayMonth: Intl.DateTimeFormat; dateTime: Intl.DateTimeFormat }> = {
  vi: {
    time: new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }),
    weekday: new Intl.DateTimeFormat("vi-VN", { weekday: "long" }),
    dayMonth: new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }),
    dateTime: new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }),
  },
  en: {
    time: new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" }),
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "long" }),
    dayMonth: new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "2-digit" }),
    dateTime: new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }),
  },
};

function fmt(kind: keyof (typeof FMT)["vi"]): Intl.DateTimeFormat {
  return FMT[useLangStore.getState().lang][kind];
}

/** Apple-Notes style: today → time, yesterday, this week → weekday, else dd/mm. */
export function shortDate(value: Date | string, now = new Date()): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "";
  const days = daysAgo(d, now);
  if (days <= 0) return fmt("time").format(d);
  if (days === 1) return getT()("sidebar.group.yesterday");
  if (days < 7) {
    const w = fmt("weekday").format(d);
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  return dayMonth(d);
}

/**
 * Day/month built by hand for Vietnamese because ICU's vi-VN pattern varies
 * between "/" and "-"; English uses its native mm/dd pattern.
 */
function dayMonth(d: Date): string {
  if (useLangStore.getState().lang === "en") return fmt("dayMonth").format(d);
  const parts = fmt("dayMonth").formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}`;
}

export function relativeTime(value: Date | string, now = new Date()): string {
  const d = toDate(value);
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000);
  if (Number.isNaN(seconds)) return "";
  const t = getT();
  if (seconds < 45) return t("sidebar.justNow");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("sidebar.minutesAgo", { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("sidebar.hoursAgo", { n: hours });
  return shortDate(d, now);
}

export function fullDateTime(value: Date | string): string {
  const d = toDate(value);
  return Number.isNaN(d.getTime()) ? "" : fmt("dateTime").format(d);
}
