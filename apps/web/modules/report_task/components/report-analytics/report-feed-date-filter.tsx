"use client";

import { DatePresetPicker } from "@/modules/report_task/components/report-analytics/date-preset-picker";
import { useReportFeedFilterStore } from "@/modules/report_task/store/report-feed-filter-store";

export function ReportFeedDateFilter() {
  const preset = useReportFeedFilterStore((s) => s.preset);
  const customFrom = useReportFeedFilterStore((s) => s.customFrom);
  const customTo = useReportFeedFilterStore((s) => s.customTo);
  const setPreset = useReportFeedFilterStore((s) => s.setPreset);
  const setCustomRange = useReportFeedFilterStore((s) => s.setCustomRange);

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
