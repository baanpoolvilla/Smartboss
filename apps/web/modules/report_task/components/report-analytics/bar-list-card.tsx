"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/modules/report_task/components/ui/tooltip";
import type { StackedRow } from "@/modules/report_task/lib/report-charts";
import type { ReportDim } from "@/modules/report_task/store/report-filter-store";
import { useReportFilterStore } from "@/modules/report_task/store/report-filter-store";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * Clean progress list (GitHub / Linear style): a fixed name column, then a slim
 * bar whose grey length = workload and green fill = how much is done. The green
 * is a thin accent, not a block the label sits on — so the colour reads as
 * "progress" and stays calm.
 *
 * When `dim` is given, each row becomes a cross-filter toggle: clicking narrows
 * the whole report to that row; `activeId` marks the selected row (others dim).
 */
export function BarListCard({
  title,
  subtitle,
  rows,
  sort = true,
  dim,
  activeId,
}: {
  title: string;
  subtitle?: string;
  rows: StackedRow[];
  sort?: boolean;
  dim?: ReportDim;
  activeId?: string | null;
}) {
  const toggle = useReportFilterStore((s) => s.toggle);
  const data = sort ? [...rows].sort((a, b) => b.total - a.total) : rows;
  const max = Math.max(...data.map((r) => r.total), 1);
  const hasActive = activeId != null;

  return (
    <Card className="border-[var(--line)] shadow-sm h-full">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
          {subtitle && <p className="text-xs text-[var(--ink-soft)]">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[var(--ink-soft)] shrink-0">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--brand-green)" }} /> เสร็จ
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "#e2e5ea" }} /> ยังไม่เสร็จ
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {data.length === 0 && <p className="text-sm text-[var(--ink-soft)] py-4 text-center">ไม่มีข้อมูล — ลองปรับตัวกรองด้านบน</p>}

        <div className="divide-y divide-[var(--line)]">
          {data.map((r) => {
            const barW = (r.total / max) * 100; // grey length = workload
            const donePct = r.total ? Math.round((r.completed / r.total) * 100) : 0;
            const isActive = hasActive && r.id === activeId;
            const clickable = !!dim;
            return (
              <div
                key={r.name}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => toggle(dim, r.id) : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle(dim, r.id);
                        }
                      }
                    : undefined
                }
                className={cn(
                  "flex items-center gap-3 py-2.5 -mx-2 px-2 rounded-md transition-all",
                  clickable && "cursor-pointer hover:bg-[var(--bg-soft)]",
                  hasActive && !isActive && "opacity-40",
                  isActive && "bg-[color-mix(in_srgb,var(--brand-green)_10%,transparent)] ring-1 ring-[var(--brand-green)]"
                )}
              >
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
                            style={{ width: `${donePct}%`, backgroundColor: "var(--brand-green)" }}
                          />
                        </div>
                      </div>
                    }
                  />
                  <TooltipContent className="text-xs">
                    {r.name}: {r.total} งาน · เสร็จ {r.completed} ({donePct}%)
                    {r.late > 0 && ` · ล่าช้า ${r.late}`}
                  </TooltipContent>
                </Tooltip>

                <span className={cn("w-9 text-right text-sm tabular-nums shrink-0", donePct >= 50 ? "font-semibold text-[var(--ink)]" : "text-[var(--ink-soft)]")}>
                  {donePct}%
                </span>
                <span className="w-14 text-right text-xs text-[var(--ink-soft)] tabular-nums shrink-0">
                  {r.total} งาน
                </span>
                <span className="w-12 flex justify-end shrink-0">
                  {r.late > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-[var(--chart-amber)] text-[10px] font-medium px-1.5 py-0.5">
                      ช้า {r.late}
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
