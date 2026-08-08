"use client";

import { X } from "lucide-react";
import { useReportFilterStore } from "@/modules/report_task/store/report-filter-store";
import { reportFilterLabel } from "@/modules/report_task/lib/report-filter";

/** Shows what the report is currently narrowed to, with a one-click clear. */
export function ReportFilterBanner() {
  const dim = useReportFilterStore((s) => s.dim);
  const value = useReportFilterStore((s) => s.value);
  const clear = useReportFilterStore((s) => s.clear);

  if (!dim || !value) return null;
  const label = reportFilterLabel(dim, value);

  return (
    <div className="flex items-center gap-2 rounded-xl border border-[var(--brand-green)] bg-[color-mix(in_srgb,var(--brand-green)_8%,transparent)] px-4 py-2.5 text-sm">
      <span className="text-[var(--ink-soft)]">กำลังดูเฉพาะ</span>
      <span className="font-medium">{label.dim}:</span>
      <span className="rounded-full bg-[var(--brand-green)] text-[var(--ink)] px-2.5 py-0.5 text-xs font-medium">
        {label.value}
      </span>
      <button
        type="button"
        onClick={clear}
        className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--ink-soft)] hover:bg-white hover:text-[var(--ink)] transition-colors"
      >
        <X className="h-3.5 w-3.5" />
        ล้างตัวกรอง
      </button>
    </div>
  );
}
