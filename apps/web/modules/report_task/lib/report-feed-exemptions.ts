import { localDateStr } from "@/modules/report_task/lib/now";
import { expandRule } from "@/modules/report_task/lib/routine-dayoff";
import type { RoutineDayOffRule } from "@/modules/report_task/store/routine-dayoff-store";
import type { CalendarEvent } from "@/modules/report_task/types";

export interface DateExemptions {
  /** userId -> set of "YYYY-MM-DD" dates that person is legitimately off (leave, routine day-off) — exempt for them only. */
  personalDates: Map<string, Set<string>>;
  /** "YYYY-MM-DD" dates nobody is expected to post on (public holidays) — exempt for everyone regardless of their personal holiday-source selection, since that selection only controls what shows on their own calendar, not whether the company was actually open that day. */
  companyDates: Set<string>;
}

/** "YYYY-MM-DD" dates from `startIso` (inclusive) to `endIso` (exclusive) — matches CalendarEvent's own exclusive-end convention. */
function eachDateExclusiveEnd(startIso: string, endIso: string): string[] {
  const start = localDateStr(new Date(startIso));
  const endExclusive = localDateStr(new Date(endIso));
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00`);
  let guard = 0;
  while (localDateStr(cursor) < endExclusive && guard < 366) {
    out.push(localDateStr(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard++;
  }
  return out;
}

/**
 * Builds the set of dates each person (and the whole company) is legitimately
 * not expected to post a report — leave, routine day-off (one-off picks and
 * expanded recurring rules), and public holidays. `monthsBack` only bounds
 * how far back recurring rules get expanded; leave/holiday events and picked
 * dates are unbounded since they're already concrete dates, not a pattern to
 * walk.
 */
export function buildDateExemptions(
  leaves: CalendarEvent[],
  holidays: CalendarEvent[],
  routineDayOff: {
    pickedDates: Record<string, string[]>;
    rules: RoutineDayOffRule[];
    ruleExceptions: Record<string, string>;
  },
  monthsBack = 3
): DateExemptions {
  const personalDates = new Map<string, Set<string>>();

  function addPersonal(userId: string | undefined, date: string) {
    if (!userId) return;
    let set = personalDates.get(userId);
    if (!set) {
      set = new Set();
      personalDates.set(userId, set);
    }
    set.add(date);
  }

  for (const leave of leaves) {
    for (const date of eachDateExclusiveEnd(leave.start, leave.end)) addPersonal(leave.userId, date);
  }

  for (const [userId, dates] of Object.entries(routineDayOff.pickedDates)) {
    for (const date of dates) addPersonal(userId, date);
  }

  const today = new Date();
  for (const rule of routineDayOff.rules) {
    for (let i = -monthsBack; i <= 1; i++) {
      const monthDate = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
      for (const date of expandRule(rule, routineDayOff.ruleExceptions, monthKey)) addPersonal(rule.userId, date);
    }
  }

  const companyDates = new Set<string>();
  for (const holiday of holidays) {
    for (const date of eachDateExclusiveEnd(holiday.start, holiday.end)) companyDates.add(date);
  }

  return { personalDates, companyDates };
}

export function isExemptDate(exemptions: DateExemptions, userId: string, date: string): boolean {
  if (exemptions.companyDates.has(date)) return true;
  return exemptions.personalDates.get(userId)?.has(date) ?? false;
}
