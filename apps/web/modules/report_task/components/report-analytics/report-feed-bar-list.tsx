"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/modules/report_task/components/ui/tooltip";
import type { ComplianceRow } from "@/modules/report_task/lib/report-feed-compliance";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * Same visual language as the Task report's BarListCard (grey bar =
 * denominator, green fill = "showed up" rate) but standalone — compliance
 * rows don't have a status/priority/department/member cross-filter dim the
 * way tasks do, so this doesn't couple to useReportFilterStore. Sorted worst
 * first (lowest compliance rate) since that's who actually needs follow-up.
 */
export function ReportFeedBarList({ title, subtitle, rows }: { title: string; subtitle?: string; rows: ComplianceRow[] }) {
  const data = [...rows].sort((a, b) => a.complianceRate - b.complianceRate);
  const max = Math.max(...data.map((r) => r.trackedDays), 1);

  return (
    <Card className="border-[var(--line)] shadow-sm h-full">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
          {subtitle && <p className="text-xs text-[var(--ink-soft)]">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[var(--ink-soft)] shrink-0">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--brand-green)" }} /> ส่งแล้ว
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "#e2e5ea" }} /> วันที่ต้องส่ง
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {data.length === 0 && <p className="text-sm text-[var(--ink-soft)] py-4 text-center">ยังไม่มีห้องที่ตั้งรอบเวลา (cutoff)</p>}

        <div className="divide-y divide-[var(--line)]">
          {data.map((r) => {
            const barW = (r.trackedDays / max) * 100;
            const postedPct = r.complianceRate;
            return (
              <div key={r.id} className="flex items-center gap-3 py-2.5 -mx-2 px-2 rounded-md">
                <span className="w-24 shrink-0 truncate text-sm font-medium" title={r.name}>
                  {r.name}
                </span>

                <Tooltip>
                  <TooltipTrigger
                    render={
                      <div className="flex-1 flex items-center h-4 cursor-default">
                        <div className="relative h-2 rounded-full bg-[#eef0f3] overflow-hidden" style={{ width: `${barW}%`, minWidth: 24 }}>
                          <div
                            className="absolute inset-y-0 left-0 rounded-full transition-all"
                            style={{ width: `${postedPct}%`, backgroundColor: "var(--brand-green)" }}
                          />
                        </div>
                      </div>
                    }
                  />
                  <TooltipContent className="text-xs">
                    {r.name}: {r.trackedDays} วัน · ส่ง {r.onTime + r.late} ({postedPct}%)
                    {r.late > 0 && ` · ช้า ${r.late}`}
                    {r.missed > 0 && ` · ไม่ส่ง ${r.missed}`}
                  </TooltipContent>
                </Tooltip>

                <span className={cn("w-9 text-right text-sm tabular-nums shrink-0", postedPct >= 50 ? "font-semibold text-[var(--ink)]" : "text-[var(--ink-soft)]")}>
                  {postedPct}%
                </span>
                <span className="w-14 text-right text-xs text-[var(--ink-soft)] tabular-nums shrink-0">
                  {r.trackedDays} วัน
                </span>
                <span className="w-12 flex justify-end shrink-0">
                  {r.missed > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 text-[var(--chart-red)] text-[10px] font-medium px-1.5 py-0.5">
                      ไม่ส่ง {r.missed}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--line)]">—</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
