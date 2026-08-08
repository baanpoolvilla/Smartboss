"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { buildStatusDonut } from "@/modules/report_task/lib/report-charts";
import { useReportFilterStore } from "@/modules/report_task/store/report-filter-store";
import { cn } from "@/modules/report_task/lib/utils";
import type { Task } from "@/modules/report_task/types";

/** Planner's Status chart: a thin donut with the open-task count in the middle. */
export function StatusDonutCard({ tasks, activeId }: { tasks: Task[]; activeId?: string | null }) {
  const { data, tasksLeft, total } = buildStatusDonut(tasks);
  const toggle = useReportFilterStore((s) => s.toggle);
  const hasActive = activeId != null;

  return (
    <Card className="border-[var(--line)] shadow-sm h-full">
      <CardHeader>
        <CardTitle className="text-base font-semibold">สถานะงาน</CardTitle>
        <p className="text-xs text-[var(--ink-soft)]">ภาพรวมงานทั้งหมด {total} งาน</p>
        {/* Late overrides status here (a "กำลังทำ"/"รอดำเนินการ" task that's
            overdue counts as "ล่าช้า" instead) — flagged explicitly so the
            numbers not matching the Task Board's 3-status breakdown 1:1
            reads as "different lens on purpose", not a data bug. */}
        <p className="text-[11px] text-[var(--ink-soft)] mt-0.5">
          งานที่เลยกำหนดนับเป็น &quot;ล่าช้า&quot; เสมอ ไม่ว่าจะอยู่สถานะไหน — ตัวเลขจึงต่างจาก Task Board ที่แบ่งตามสถานะล้วน ๆ
        </p>
      </CardHeader>
      <CardContent>
        {/* `data` drops every zero-value segment (buildStatusDonut) — once a
            filter narrows the result to zero tasks, that leaves an empty
            array. Recharts' <Pie> renders no arcs at all for an empty
            dataset, so without this guard the card was just the floating
            center number (tasksLeft) in an otherwise blank box — no chart,
            no legend, easy to mistake for a broken/unmounted chart. Same
            empty-state pattern as report-feed-status-pie.tsx. */}
        {total === 0 ? (
          <p className="text-sm text-[var(--ink-soft)] text-center py-16">ไม่มีงานในช่วงเวลานี้</p>
        ) : (
          <>
            <div className="h-[170px] relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="label"
                    // Thin ring — less colour area, same information.
                    innerRadius={66}
                    outerRadius={80}
                    paddingAngle={2}
                    cornerRadius={4}
                    stroke="#ffffff"
                    strokeWidth={2}
                  >
                    {data.map((d) => (
                      <Cell
                        key={d.segment}
                        fill={d.color}
                        cursor="pointer"
                        opacity={hasActive && d.segment !== activeId ? 0.35 : 1}
                        stroke={d.segment === activeId ? d.color : "#ffffff"}
                        onClick={() => toggle("status", d.segment)}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, _n, item) => [
                      `${value} งาน (${total ? Math.round((Number(value) / total) * 100) : 0}%)`,
                      item.payload.label,
                    ]}
                    wrapperStyle={{ zIndex: 50, outline: "none" }}
                    allowEscapeViewBox={{ x: true, y: true }}
                    contentStyle={{ borderRadius: 8, borderColor: "var(--line)", fontSize: 13, background: "#fff", boxShadow: "0 8px 24px -8px rgba(17,17,17,0.22)" }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-3xl font-semibold tabular-nums">{tasksLeft}</span>
                <span className="text-xs text-[var(--ink-soft)]">งานคงเหลือ</span>
              </div>
            </div>

            {/* Direct labels — the numbers carry it, the dot is just a cue */}
            <div className="space-y-1 mt-2">
              {data.map((d) => {
                const isActive = hasActive && d.segment === activeId;
                return (
                  <button
                    key={d.segment}
                    type="button"
                    onClick={() => toggle("status", d.segment)}
                    className={cn(
                      "w-full flex items-center justify-between text-sm gap-2 -mx-2 px-2 py-1 rounded-md transition-all text-left",
                      "hover:bg-[var(--bg-soft)] cursor-pointer",
                      hasActive && !isActive && "opacity-40",
                      isActive && "bg-[color-mix(in_srgb,var(--brand-green)_10%,transparent)] ring-1 ring-[var(--brand-green)]"
                    )}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                      <span className="truncate text-[var(--ink-soft)]">{d.label}</span>
                    </span>
                    <span className="tabular-nums shrink-0">
                      <span className="font-medium">{d.value}</span>
                      <span className="text-[var(--ink-soft)]"> · {total ? Math.round((d.value / total) * 100) : 0}%</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
