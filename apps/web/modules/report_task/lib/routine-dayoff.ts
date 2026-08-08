import { localDateStr } from "@/modules/report_task/lib/now";

/** How many routine days off `departmentId` gets per month — the company
 * default, unless department overrides are on and this department has its
 * own value set. */
export function quotaForDepartment(
  departmentId: string | undefined,
  companyMonthlyQuota: number,
  departmentQuotas: Record<string, number>,
  useDepartmentOverrides: boolean
): number {
  if (!useDepartmentOverrides || !departmentId) return companyMonthlyQuota;
  return departmentQuotas[departmentId] ?? companyMonthlyQuota;
}

export function monthlyUsage(pickedDates: string[], monthKey: string): number {
  return pickedDates.filter((d) => d.slice(0, 7) === monthKey).length;
}


type RoutineRuleLike = { id: string; weekday: number; startDate: string; endDate?: string };

/** Walks a rule's natural weekly cadence (every 7 days from its first
 * matching weekday on/after `startDate`, up to `endDate`/a horizon cap),
 * pairing each *natural* occurrence date with its *effective* one —
 * `ruleExceptions` is always keyed by the natural date (see `expandRule`'s
 * doc comment), so anything that needs to write a NEW exception for an
 * occurrence has to resolve back to this natural key first, not reuse
 * whatever date happens to be currently displayed (which may itself already
 * be a previously-moved effective date — using that as the key silently
 * writes to a spot `expandRule` never reads, i.e. "move" quietly does
 * nothing the second time). */
function* walkRuleOccurrences(
  rule: RoutineRuleLike,
  ruleExceptions: Record<string, string>,
  horizonMonths: number
): Generator<{ natural: string; effective: string | null }> {
  const start = new Date(`${rule.startDate}T00:00:00`);
  const dayDiff = (rule.weekday - start.getDay() + 7) % 7;
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + dayDiff);
  const capByHorizon = new Date(start);
  capByHorizon.setMonth(capByHorizon.getMonth() + horizonMonths);
  const horizonEnd = rule.endDate
    ? (() => {
        const explicit = new Date(`${rule.endDate}T00:00:00`);
        return explicit < capByHorizon ? explicit : capByHorizon;
      })()
    : capByHorizon;

  while (cursor <= horizonEnd) {
    const natural = localDateStr(cursor);
    const exception = ruleExceptions[`${rule.id}:${natural}`];
    const effective = exception === "cancelled" ? null : exception ?? natural;
    yield { natural, effective };
    cursor.setDate(cursor.getDate() + 7);
  }
}

/** Concrete occurrence dates (post-exceptions) of a weekly routine that fall
 * in `targetMonth` ("YYYY-MM") — walks week by week from the rule's start
 * date rather than scanning the target month's calendar days directly, so a
 * single occurrence moved across a month boundary (via `ruleExceptions`)
 * still shows up in the month it actually landed in, not the one it left. */
export function expandRule(
  rule: RoutineRuleLike,
  ruleExceptions: Record<string, string>,
  targetMonth: string,
  horizonMonths = 15
): string[] {
  const dates: string[] = [];
  for (const { effective } of walkRuleOccurrences(rule, ruleExceptions, horizonMonths)) {
    if (effective && effective.slice(0, 7) === targetMonth) dates.push(effective);
  }
  return dates.sort();
}

/** Same occurrences as `expandRule`, but each paired with the natural date
 * it came from — for callers that need to act on an occurrence later (move,
 * cancel) rather than just display/count it, since that requires the
 * natural key up front instead of a second reverse lookup. */
export function expandRuleOccurrences(
  rule: RoutineRuleLike,
  ruleExceptions: Record<string, string>,
  targetMonth: string,
  horizonMonths = 15
): { date: string; naturalDate: string }[] {
  const items: { date: string; naturalDate: string }[] = [];
  for (const { natural, effective } of walkRuleOccurrences(rule, ruleExceptions, horizonMonths)) {
    if (effective && effective.slice(0, 7) === targetMonth) items.push({ date: effective, naturalDate: natural });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/** Reverse lookup: given a date currently *displayed* for this rule (post-
 * exceptions), find the natural occurrence date it actually belongs to —
 * needed before writing a new exception (move/cancel), since exceptions are
 * always keyed by the natural date, not whatever's on screen right now. */
export function naturalOccurrenceFor(
  rule: RoutineRuleLike,
  ruleExceptions: Record<string, string>,
  effectiveDate: string,
  horizonMonths = 15
): string | null {
  for (const { natural, effective } of walkRuleOccurrences(rule, ruleExceptions, horizonMonths)) {
    if (effective === effectiveDate) return natural;
  }
  return null;
}

/** How many total days `targetMonth` would have after adding a new recurring
 *  rule (previewed by its weekdays + date range) on top of what's already
 *  used — deduped against `existingDatesThisMonth`, so a projected occurrence
 *  that happens to land on an already-picked/already-scheduled date doesn't
 *  count twice toward quota. Shared by every entry point that lets someone
 *  add a recurring routine day off (calendar sidebar, new-item dialog) so
 *  the accept/reject decision can't drift between them. */
export function projectedRoutineQuotaTotal(
  weekdays: number[],
  startDate: string,
  endDate: string | undefined,
  targetMonth: string,
  existingDatesThisMonth: string[]
): number {
  const existing = new Set(existingDatesThisMonth);
  const projected = weekdays.flatMap((weekday) =>
    expandRule({ id: "preview", weekday, startDate, endDate }, {}, targetMonth)
  );
  const newDatesCount = new Set(projected.filter((d) => !existing.has(d))).size;
  return existing.size + newDatesCount;
}

const WEEKDAY_LABELS_TH = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
export const WEEKDAY_SHORT_TH = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

export function weekdayLabelTh(weekday: number): string {
  return WEEKDAY_LABELS_TH[weekday] ?? "";
}
