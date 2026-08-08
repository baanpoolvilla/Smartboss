import { holidaySource } from "@/modules/report_task/store/holiday-store";
import type { CalendarEvent } from "@/modules/report_task/types";

/**
 * Builds a monthly grant resolver for a "sourced from a country's public
 * holiday calendar" leave type — the grant for a given month is the number of
 * that country's public holidays falling in it, unless an admin has manually
 * overridden that specific month (see `LeaveTypeDef.monthlyGrantOverrides`).
 */
export function countryHolidayGrantResolver(
  holidays: CalendarEvent[],
  countryCode: string,
  overrides: Record<string, number> | undefined
): (monthKey: string) => number {
  return (monthKey) => {
    if (overrides?.[monthKey] !== undefined) return overrides[monthKey];
    return holidays.filter((h) => holidaySource(h) === countryCode && h.start.slice(0, 7) === monthKey).length;
  };
}
