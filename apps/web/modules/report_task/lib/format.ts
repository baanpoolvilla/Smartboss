import { now, nowMs, localDateStr, todayIso } from "./now";

const TH_LOCALE = "th-TH-u-ca-gregory";

/**
 * Date-only fields (dueDate, startDate, revision dates, ...) are stored as
 * UTC-midnight-of-the-chosen-day (`new Date("YYYY-MM-DD")` is always parsed
 * as UTC per spec), so they must be *read* back via their UTC components too
 * — reading them through the viewer's local timezone silently rolls the
 * displayed day back or forward depending on the viewer's UTC offset.
 */
export function formatDate(input: string | Date, opts?: Intl.DateTimeFormatOptions) {
  const d = typeof input === "string" ? new Date(input) : input;
  return d.toLocaleDateString(TH_LOCALE, { day: "numeric", month: "short", year: "numeric", ...opts, timeZone: "UTC" });
}

/**
 * UTC construction + UTC mutation — matches how date-only fields are stored
 * (UTC-midnight-of-the-chosen-day, see `formatDate` above). Mixing a local
 * `setDate()` with a UTC-parsed value rolls the result a day off for
 * non-zero UTC offsets (e.g. Bangkok), which is the "picked the 25th, shows
 * the 24th" class of bug.
 */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatShortDate(input: string | Date) {
  return formatDate(input, { day: "numeric", month: "short" });
}

export function formatDateTime(input: string | Date) {
  const d = typeof input === "string" ? new Date(input) : input;
  return d.toLocaleString(TH_LOCALE, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function relativeTime(input: string | Date) {
  const d = typeof input === "string" ? new Date(input) : input;
  const diffMs = nowMs() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "เมื่อสักครู่";
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ชม. ที่แล้ว`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay} วันที่แล้ว`;
  return formatShortDate(d);
}

/** "วันนี้ · 7 ส.ค. 2569" / "เมื่อวาน · ..." / plain date — for a feed's day separators. Local calendar day, not the UTC-midnight convention `formatDate` otherwise assumes (this reads a real timestamp, not a date-only field). */
export function dayLabelFor(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  const dayStr = localDateStr(d);
  const dateLabel = formatDate(d);
  if (dayStr === todayIso()) return `วันนี้ · ${dateLabel}`;
  const yesterday = now();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayStr === localDateStr(yesterday)) return `เมื่อวาน · ${dateLabel}`;
  return dateLabel;
}

/** Splits a chronologically-sorted list into day-labeled runs, for a feed's "— วันนี้ · 7 ส.ค. 2569 —" separators. Assumes items are already in date order — it only watches for the calendar day changing, it doesn't sort. */
export function groupByDay<T>(items: T[], getDate: (item: T) => string): { key: string; label: string; items: T[] }[] {
  const groups: { key: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const d = new Date(getDate(item));
    const key = localDateStr(d);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.key === key) {
      lastGroup.items.push(item);
    } else {
      groups.push({ key, label: dayLabelFor(d), items: [item] });
    }
  }
  return groups;
}

/** Real file size (bytes) as a short human string — "240 KB", "3.4 MB". */
export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function daysUntil(input: string | Date) {
  const d = typeof input === "string" ? new Date(input) : input;
  // Read the target's UTC calendar day (see formatDate above) against the
  // viewer's actual local "today" — mixing the two intentionally, since the
  // former is a fixed chosen day and the latter is the real current date.
  const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const n = now();
  const todayMidnight = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((target - todayMidnight) / (1000 * 60 * 60 * 24));
}
