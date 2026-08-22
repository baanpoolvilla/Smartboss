import { now, nowMs, localDateStr, todayIso } from "./now";

const TH_LOCALE = "th-TH-u-ca-gregory";

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Date-only fields (dueDate, startDate, revision dates, ...) are stored as
 * UTC-midnight-of-the-chosen-day (`new Date("YYYY-MM-DD")` is always parsed
 * as UTC per spec), so they must be *read* back via their UTC components too
 * — reading them through the viewer's local timezone silently rolls the
 * displayed day back or forward depending on the viewer's UTC offset.
 *
 * Numeric dd/mm/yyyy (Gregorian year), not a localized "13 ส.ค. 2026" —
 * every date shown across report_task reads the same fixed digits-only
 * format regardless of viewer locale, instead of mixing a spelled-out Thai
 * month in some places and a native-picker's OS-locale format in others.
 */
export function formatDate(input: string | Date) {
  const d = typeof input === "string" ? new Date(input) : input;
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
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

/** Same numeric dd/mm/yyyy as `formatDate` — kept as its own name since call
 * sites already read as "the compact one", even though the output (unlike
 * before this always included the year regardless of the "short" name). */
export function formatShortDate(input: string | Date) {
  return formatDate(input);
}

export function formatDateTime(input: string | Date) {
  const d = typeof input === "string" ? new Date(input) : input;
  const time = d.toLocaleTimeString(TH_LOCALE, { hour: "numeric", minute: "2-digit" });
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${time}`;
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

/** "วันนี้ · 07/08/2026" / "เมื่อวาน · ..." / plain date — for a feed's day separators. Local calendar day, not the UTC-midnight convention `formatDate` otherwise assumes (this reads a real timestamp, not a date-only field). */
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

/** Splits a chronologically-sorted list into day-labeled runs, for a feed's "— วันนี้ · 07/08/2026 —" separators. Assumes items are already in date order — it only watches for the calendar day changing, it doesn't sort. */
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
