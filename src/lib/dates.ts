const LOCALE = "vi-VN";

export type TimeBucket = "today" | "yesterday" | "week" | "month" | "older";

const BUCKET_ORDER: TimeBucket[] = ["today", "yesterday", "week", "month", "older"];

const BUCKET_LABEL: Record<TimeBucket, string> = {
  today: "Hôm nay",
  yesterday: "Hôm qua",
  week: "7 ngày qua",
  month: "30 ngày qua",
  older: "Cũ hơn",
};

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

/** ChatGPT-style sections: Hôm nay / Hôm qua / 7 ngày qua / 30 ngày qua / Cũ hơn. */
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
    label: BUCKET_LABEL[key],
    items: buckets.get(key)!,
  }));
}

const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: "long" });
const dayMonthFmt = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" });

/** Apple-Notes style: today → time, yesterday, this week → weekday, else dd/mm. */
export function shortDate(value: Date | string, now = new Date()): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "";
  const days = daysAgo(d, now);
  if (days <= 0) return timeFmt.format(d);
  if (days === 1) return "Hôm qua";
  if (days < 7) {
    const w = weekdayFmt.format(d);
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  return dayMonth(d);
}

/** dd/mm — built by hand because ICU's vi-VN pattern varies between "/" and "-". */
function dayMonth(d: Date): string {
  const parts = dayMonthFmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}`;
}

export function relativeTime(value: Date | string, now = new Date()): string {
  const d = toDate(value);
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000);
  if (Number.isNaN(seconds)) return "";
  if (seconds < 45) return "vừa xong";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return shortDate(d, now);
}

export function fullDateTime(value: Date | string): string {
  const d = toDate(value);
  return Number.isNaN(d.getTime()) ? "" : dateTimeFmt.format(d);
}
