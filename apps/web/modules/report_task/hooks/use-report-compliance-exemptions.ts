"use client";

import { useMemo } from "react";
import { useLeaveStore } from "@/modules/report_task/store/leave-store";
import { useHolidayStore } from "@/modules/report_task/store/holiday-store";
import { useRoutineDayOffStore } from "@/modules/report_task/store/routine-dayoff-store";
import { buildDateExemptions, type DateExemptions } from "@/modules/report_task/lib/report-feed-exemptions";

/**
 * Report-compliance date exemptions (leave, holiday, routine day-off), built
 * once from the three underlying stores and memoized — every compliance
 * widget/table calls this instead of re-deriving it, so a day someone is
 * legitimately off never gets penalized as "missed" wherever compliance is
 * computed.
 */
export function useReportComplianceExemptions(): DateExemptions {
  const leaves = useLeaveStore((s) => s.leaves);
  const holidays = useHolidayStore((s) => s.holidays);
  const pickedDates = useRoutineDayOffStore((s) => s.pickedDates);
  const rules = useRoutineDayOffStore((s) => s.rules);
  const ruleExceptions = useRoutineDayOffStore((s) => s.ruleExceptions);

  return useMemo(
    () => buildDateExemptions(leaves, holidays, { pickedDates, rules, ruleExceptions }),
    [leaves, holidays, pickedDates, rules, ruleExceptions]
  );
}
