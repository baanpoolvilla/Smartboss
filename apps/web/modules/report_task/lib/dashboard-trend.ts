import { presetRange, type DatePreset } from "@/modules/report_task/lib/date-filter";

/**
 * The period immediately before whatever `presetRange` resolved to, same
 * length — "last week" when the filter is "สัปดาห์นี้", "yesterday" when
 * it's "วันนี้", the prior calendar-length chunk for "กำหนดเอง", etc. One
 * generic rule instead of special-casing every preset, and it automatically
 * follows the Dashboard's own date filter instead of a trend that's stuck
 * comparing fixed weeks no matter what the filter bar says.
 * Returns null for "ทั้งหมด" (unbounded) — there's no "previous all-time" to
 * compare against.
 */
export function previousPeriodRange(preset: DatePreset, customFrom: string, customTo: string): { from: Date; to: Date } | null {
  const current = presetRange(preset, customFrom, customTo);
  if (!current) return null;
  const lengthMs = current.to.getTime() - current.from.getTime();
  const to = new Date(current.from.getTime() - 1);
  const from = new Date(to.getTime() - lengthMs);
  return { from, to };
}

export type TrendDirection = "up" | "down" | "flat";

export interface Trend {
  direction: TrendDirection;
  /** Percent change vs. the previous period — null when there's nothing to compare against (no data last period, or preset is "ทั้งหมด"). */
  percent: number | null;
}

/** Current-period vs. previous-period comparison — `higherIsGood` just picks which direction gets the green "up" framing (e.g. more overdue is bad, so a rise there should read as a warning, not a win). */
export function periodTrend(current: number, previous: number): Trend {
  if (previous === 0) {
    if (current === 0) return { direction: "flat", percent: null };
    return { direction: "up", percent: null };
  }
  const percent = Math.round(((current - previous) / previous) * 100);
  return { direction: percent > 0 ? "up" : percent < 0 ? "down" : "flat", percent };
}
