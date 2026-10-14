import { localDateStr } from "@/modules/report_task/lib/now";
import { expandRule } from "@/modules/report_task/lib/routine-dayoff";
import type { RoutineDayOffRule } from "@/modules/report_task/store/routine-dayoff-store";
import type { CalendarEvent } from "@/modules/report_task/types";

export interface DateExemptions {
  /** userId -> set of "YYYY-MM-DD" dates that person is legitimately off (leave, routine day-off) — exempt for them only. */
  personalDates: Map<string, Set<string>>;
  /** "YYYY-MM-DD" dates nobody is expected to post on (public holidays) — exempt for everyone regardless of their personal holiday-source selection, since that selection only controls what shows on their own calendar, not whether the company was actually open that day. */
  companyDates: Set<string>;
  /**
   * วันหยุดบริษัทที่ผ่านไปก่อน HOLIDAY_CREDIT_RULE_FROM ของบริษัทที่ใช้ Holiday สะสม — ตอนนั้นระบบบอกทุกคน
   * ว่าไม่ต้องส่ง ⇒ ยังยกเว้นการนับ "ไม่ส่ง/เลยกำหนด" (แดชบอร์ด + หักคะแนน) แต่โพสต์ที่ส่งมาแล้ว
   * ขึ้นป้ายรอบตามปกติ (isExemptDate ด้วย ignoreLegacyHolidays)
   */
  legacyHolidayDates?: Set<string>;
}

/** วันที่เริ่มใช้กติกา "Holiday สะสม = วันหยุดราชการไม่ยกเว้นการส่งรายงาน" — วันหยุดก่อนนี้ไม่ย้อนนับว่าไม่ส่ง */
export const HOLIDAY_CREDIT_RULE_FROM = "2026-10-15";

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
 *
 * `holidaysAreLeaveCredit` — the company converts public holidays into a
 * Holiday leave balance each person spends on a day of their own choosing
 * (HR leave type `accrues_from_holidays`). The holiday calendar then isn't a
 * day everyone is off, so it exempts nobody; only the Holiday leave someone
 * actually logs does (via `leaves`). Holidays before HOLIDAY_CREDIT_RULE_FROM
 * go to `legacyHolidayDates` instead (see that field).
 */
export function buildDateExemptions(
  leaves: CalendarEvent[],
  holidays: CalendarEvent[],
  routineDayOff: {
    pickedDates: Record<string, string[]>;
    rules: RoutineDayOffRule[];
    ruleExceptions: Record<string, string>;
  },
  monthsBack = 3,
  holidaysAreLeaveCredit = false
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
    // Work From Home and similar: no clock-in, but reports are still due.
    if (leave.requiresReports) continue;
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
  const legacyHolidayDates = new Set<string>();
  for (const holiday of holidays) {
    for (const date of eachDateExclusiveEnd(holiday.start, holiday.end)) {
      if (!holidaysAreLeaveCredit) companyDates.add(date);
      else if (date < HOLIDAY_CREDIT_RULE_FROM) legacyHolidayDates.add(date);
    }
  }

  return { personalDates, companyDates, legacyHolidayDates };
}

export function isExemptDate(
  exemptions: DateExemptions,
  userId: string,
  date: string,
  options?: { ignoreLegacyHolidays?: boolean }
): boolean {
  if (exemptions.companyDates.has(date)) return true;
  if (!options?.ignoreLegacyHolidays && exemptions.legacyHolidayDates?.has(date)) return true;
  return exemptions.personalDates.get(userId)?.has(date) ?? false;
}
