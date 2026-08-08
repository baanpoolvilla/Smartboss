"use client";

import { DatePresetPicker } from "@/modules/report_task/components/report-analytics/date-preset-picker";
import { useReportFilterStore } from "@/modules/report_task/store/report-filter-store";

export function ReportDateFilter() {
  const preset = useReportFilterStore((s) => s.preset);
  const customFrom = useReportFilterStore((s) => s.customFrom);
  const customTo = useReportFilterStore((s) => s.customTo);
  const setPreset = useReportFilterStore((s) => s.setPreset);
  const setCustomRange = useReportFilterStore((s) => s.setCustomRange);

  return (
    <DatePresetPicker
      preset={preset}
      customFrom={customFrom}
      customTo={customTo}
      onPresetChange={setPreset}
      onCustomRangeChange={setCustomRange}
    />
  );
}
