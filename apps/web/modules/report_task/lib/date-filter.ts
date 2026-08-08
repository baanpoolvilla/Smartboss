import { now } from "@/modules/report_task/lib/now";
import type { Task, TaskPriority } from "@/modules/report_task/types";

export type DatePreset = "today" | "week" | "month" | "custom" | "all";

export const datePresetLabels: Record<DatePreset, string> = {
  today: "วันนี้",
  week: "สัปดาห์นี้",
  month: "เดือนนี้",
  custom: "กำหนดเอง",
  all: "ทั้งหมด",
};

export function presetRange(preset: DatePreset, customFrom?: string, customTo?: string): { from: Date; to: Date } | null {
  if (preset === "all") return null;
  const anchor = now();
  if (preset === "today") {
    // Reset to local midnight — reusing `anchor` as-is left `from` sitting at
    // right-now's wall-clock time instead of the start of the day, so any
    // task due "today" (stored as UTC-midnight-of-the-day, see format.ts)
    // read as due *before* `from` for the rest of the day and got filtered out.
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    const to = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 23, 59, 59, 999);
    return { from, to };
  }
  if (preset === "week") {
    const day = anchor.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const from = new Date(anchor);
    from.setDate(anchor.getDate() + diffToMonday);
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }
  if (preset === "month") {
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999);
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
