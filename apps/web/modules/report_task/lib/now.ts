/**
 * Single source of truth for "the current moment" across the app.
 * Everything that needs "today"/"now" at runtime (lateness, relative time,
 * date filters, calendar's initial view, default due dates) should read
 * from here instead of hardcoding a date, so they never drift out of sync
 * with each other or with the real clock.
 */
export function now(): Date {
  return new Date();
}

export function nowMs(): number {
  return Date.now();
}

/**
 * Today's date in the viewer's local calendar, as YYYY-MM-DD. Deliberately
 * uses local getters, not `.toISOString().slice(0, 10)` — converting "now"
 * to UTC first can land on the wrong calendar day near midnight depending
 * on the viewer's timezone offset.
 */
export function todayIso(): string {
  return localDateStr(now());
}

/**
 * Same local-getter logic as `todayIso`, generalized to any Date — the
 * calendar (FullCalendar, default `timeZone: 'local'`) resolves a full ISO
 * instant like Google Calendar's `2026-07-17T17:00:00.000Z` to "the local
 * calendar day it falls in," which for a positive UTC offset (e.g. Bangkok)
 * is often the *next* date. Reading it back with `.toISOString().slice(0,10)`
 * disagrees with what's actually drawn on the grid; local getters agree.
 */
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Accepts either a plain "YYYY-MM-DD" (already unambiguous, passed through
 * as-is) or a full ISO instant (converted via local getters — see
 * `localDateStr`) — so callers that mix internal date-only fields with
 * external calendar timestamps don't need to know which they have. */
export function calendarDateOf(dateOrIso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOrIso)) return dateOrIso;
  return localDateStr(new Date(dateOrIso));
}
