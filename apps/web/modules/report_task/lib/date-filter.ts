import { now } from "@/modules/report_task/lib/now";
import type { Task, TaskPriority } from "@/modules/report_task/types";

// §7.3 of DASHBOARD_REDESIGN_PROMPT.md — 12 presets. "all" isn't in that
// list but is kept as an extra (unbounded) option since several existing
// defaults (dashboard-filter-store's initial preset, escalations-panel's
// "show everything overdue") depend on range=null meaning "no restriction"
// — dropping it would be a real behavior regression the spec never asked for.
export type DatePreset =
  | "today"
  | "yesterday"
  | "week_to_date"
  | "week"
  | "week_last"
  | "month_to_date"
  | "month"
  | "month_last"
  | "year_to_date"
  | "year"
  | "year_last"
  | "custom"
  | "all";

export const datePresetLabels: Record<DatePreset, string> = {
  today: "วันนี้",
  yesterday: "เมื่อวาน",
  week_to_date: "สะสมรายสัปดาห์",
  week: "สัปดาห์นี้",
  week_last: "สัปดาห์ที่แล้ว",
  month_to_date: "สะสมรายเดือน",
  month: "เดือนนี้",
  month_last: "เดือนที่แล้ว",
  year_to_date: "สะสมรายปี",
  year: "ปีนี้",
  year_last: "ปีที่แล้ว",
  custom: "กำหนดเอง",
  all: "ทั้งหมด",
};

/** Groups the dropdown into วันนี้/สัปดาห์/เดือน/ปี/กำหนดเอง sections, widest→narrowest, matching the inverted-pyramid ordering used everywhere else. */
export const datePresetGroups: { label: string; presets: DatePreset[] }[] = [
  { label: "", presets: ["all", "today", "yesterday"] },
  { label: "สัปดาห์", presets: ["week_to_date", "week", "week_last"] },
  { label: "เดือน", presets: ["month_to_date", "month", "month_last"] },
  { label: "ปี", presets: ["year_to_date", "year", "year_last"] },
  { label: "", presets: ["custom"] },
];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function mondayOf(d: Date) {
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const from = new Date(d);
  from.setDate(d.getDate() + diffToMonday);
  return startOfDay(from);
}

export function presetRange(preset: DatePreset, customFrom?: string, customTo?: string): { from: Date; to: Date } | null {
  if (preset === "all") return null;
  const anchor = now();

  if (preset === "today") return { from: startOfDay(anchor), to: endOfDay(anchor) };

  if (preset === "yesterday") {
    const y = new Date(anchor);
    y.setDate(anchor.getDate() - 1);
    return { from: startOfDay(y), to: endOfDay(y) };
  }

  if (preset === "week_to_date") return { from: mondayOf(anchor), to: endOfDay(anchor) };

  if (preset === "week") {
    const from = mondayOf(anchor);
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    return { from, to: endOfDay(to) };
  }

  if (preset === "week_last") {
    const thisMonday = mondayOf(anchor);
    const from = new Date(thisMonday);
    from.setDate(thisMonday.getDate() - 7);
    const to = new Date(thisMonday);
    to.setDate(thisMonday.getDate() - 1);
    return { from, to: endOfDay(to) };
  }

  if (preset === "month_to_date") {
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    return { from, to: endOfDay(anchor) };
  }

  if (preset === "month") {
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999);
    return { from, to };
  }

  if (preset === "month_last") {
    const from = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
    const to = new Date(anchor.getFullYear(), anchor.getMonth(), 0, 23, 59, 59, 999);
    return { from, to };
  }

  if (preset === "year_to_date") {
    const from = new Date(anchor.getFullYear(), 0, 1);
    return { from, to: endOfDay(anchor) };
  }

  if (preset === "year") {
    const from = new Date(anchor.getFullYear(), 0, 1);
    const to = new Date(anchor.getFullYear(), 11, 31, 23, 59, 59, 999);
    return { from, to };
  }

  if (preset === "year_last") {
    const from = new Date(anchor.getFullYear() - 1, 0, 1);
    const to = new Date(anchor.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
    return { from, to };
  }

  // custom
  if (!customFrom || !customTo) return null;
  const from = new Date(customFrom);
  const to = new Date(customTo);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

export function monthLabel(d: Date) {
  return d.toLocaleDateString("th-TH-u-ca-gregory", { month: "long", year: "numeric" });
}

export function inMonth(dateStr: string, year: number, month: number) {
  const d = new Date(dateStr);
  return d.getFullYear() === year && d.getMonth() === month;
}

/** The exact visible range of whichever FullCalendar view is active. */
export interface ViewRange {
  start: Date;
  end: Date;
  viewType: "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listMonth";
}

/**
 * Half-open [start, end) day check for date-only fields (task dueDate, leave
 * start, holiday start — all anchored to UTC-midnight-of-the-chosen-day, see
 * format.ts). Compares UTC calendar days against the range's local calendar
 * days so it doesn't depend on the viewer's timezone offset.
 */
export function inRange(dateStr: string, range: ViewRange): boolean {
  const d = new Date(dateStr);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const start = Date.UTC(range.start.getFullYear(), range.start.getMonth(), range.start.getDate());
  const end = Date.UTC(range.end.getFullYear(), range.end.getMonth(), range.end.getDate());
  return day >= start && day < end;
}

/** Same as `inRange`, but for real timestamps (meeting start/end) — local components on both sides. */
export function inRangeLocal(dateStr: string, range: ViewRange): boolean {
  const d = new Date(dateStr);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const start = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate()).getTime();
  const end = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate()).getTime();
  return day >= start && day < end;
}

/** Human label for a view range, e.g. "วันนี้", "17 – 23 ก.ค.", "กรกฎาคม 2026". */
export function rangeLabel(range: ViewRange): string {
  const dayOpts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (range.viewType === "timeGridDay") {
    return range.start.toLocaleDateString("th-TH-u-ca-gregory", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  if (range.viewType === "timeGridWeek") {
    const lastDay = new Date(range.end.getTime() - 1);
    return `${range.start.toLocaleDateString("th-TH-u-ca-gregory", dayOpts)} – ${lastDay.toLocaleDateString("th-TH-u-ca-gregory", dayOpts)}`;
  }
  return monthLabel(range.start);
}

export function filterTasksByDashboard(
  taskList: Task[],
  opts: {
    personId: string;
    preset: DatePreset;
    customFrom?: string;
    customTo?: string;
    departmentId?: string;
    priority?: TaskPriority | "all";
  }
): Task[] {
  const range = presetRange(opts.preset, opts.customFrom, opts.customTo);
  return taskList.filter((t) => {
    if (opts.personId !== "all" && !t.assigneeIds.includes(opts.personId)) return false;
    if (opts.departmentId && opts.departmentId !== "all" && !t.departmentIds.includes(opts.departmentId)) return false;
    if (opts.priority && opts.priority !== "all" && t.priority !== opts.priority) return false;
    if (range) {
      const due = new Date(t.dueDate).getTime();
      if (due < range.from.getTime() || due > range.to.getTime()) return false;
    }
    return true;
  });
}
