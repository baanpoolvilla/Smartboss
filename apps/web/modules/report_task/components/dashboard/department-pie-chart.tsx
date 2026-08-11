"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from "recharts";
import type { PieSectorDataItem } from "recharts/types/polar/Pie";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { departments, getUser } from "@/modules/report_task/data/mock";
import { buildDepartmentReports } from "@/modules/report_task/lib/reports";
import { chartGray, departmentColorOrder } from "@/modules/report_task/lib/chart-colors";
import { useHasHover } from "@/modules/report_task/hooks/use-has-hover";
import { useDashboardTasks } from "@/modules/report_task/hooks/use-dashboard-tasks";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { ChartTooltip } from "@/modules/report_task/components/shared/chart-tooltip";
import { cn } from "@/modules/report_task/lib/utils";
import { KanbanSquare } from "lucide-react";

const MAX_SLICES = 5;

interface DeptSlice {
  id: string;
  department: string;
  completedTasks: number;
  lateTasks: number;
  percent: number;
  color: string;
}

// hover-grow (§8.2): the active slice's outerRadius bumps out ~4px, same as
// every other clickable pie on the Dashboard.
// Recharts hands this function a props object that includes a `key` —
// spreading that straight into JSX triggers React's "key must be passed
// directly" warning, so it's pulled out and passed on its own instead.
function renderActiveShape({ key, ...props }: PieSectorDataItem & { key?: React.Key | null }) {
  return <Sector key={key} {...props} outerRadius={(props.outerRadius ?? 0) + 4} />;
}

/** "ผลงานแยกตามแผนก" — Pie of completed-task counts per department (a real additive
 * quantity, unlike a rate), colored one distinct hue per department (§8) — coloring by
 * each department's own rate was tried first, but once most departments land in the
 * same band the donut turns almost one solid color and departments stop being
 * distinguishable, which defeats the point of a per-department chart. Departments
 * beyond the top 5 fold into a gray "อื่นๆ" slice. */
export function DepartmentPieChart() {
  const tasks = useDashboardTasks();
  const personId = useDashboardFilterStore((s) => s.personId);
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const setDepartmentId = useDashboardFilterStore((s) => s.setDepartmentId);
  const router = useRouter();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hasHover = useHasHover();

  // A department or person filter narrows to one department already —
  // showing every other (now-empty) department alongside it read as "no
  // data" instead of "not selected". Narrow the slices to match.
  const shownDepartmentIds = useMemo(() => {
    if (departmentId !== "all") return new Set([departmentId]);
    if (personId !== "all") {
      const dept = getUser(personId)?.departmentId;
      return dept ? new Set([dept]) : new Set(departments.map((d) => d.id));
    }
    return new Set(departments.map((d) => d.id));
  }, [departmentId, personId]);

  const { data, total } = useMemo(() => {
    const reports = buildDepartmentReports(tasks);
    const rows = departments
      .filter((d) => shownDepartmentIds.has(d.id))
      .map((d) => {
        const r = reports.find((rep) => rep.departmentId === d.id)!;
        return { id: d.id, department: d.name, completedTasks: r.completedTasks, lateTasks: r.lateTasks, completionRate: r.completionRate };
      })
      .sort((a, b) => b.completedTasks - a.completedTasks);

    const total = rows.reduce((sum, r) => sum + r.completedTasks, 0);
    const withPercent = (r: (typeof rows)[number], color: string) => ({
      ...r,
      color,
      percent: total ? Math.round((r.completedTasks / total) * 100) : 0,
    });

    if (rows.length <= MAX_SLICES + 1) {
      return { data: rows.map((r, i) => withPercent(r, departmentColorOrder[i % departmentColorOrder.length]!!!!)), total };
    }

    const top = rows.slice(0, MAX_SLICES).map((r, i) => withPercent(r, departmentColorOrder[i]!));
    const rest = rows.slice(MAX_SLICES);
    const other = withPercent(
      {
        id: "other",
        department: "อื่นๆ",
        completedTasks: rest.reduce((sum, r) => sum + r.completedTasks, 0),
        lateTasks: rest.reduce((sum, r) => sum + r.lateTasks, 0),
        completionRate: 0,
      },
      chartGray
    );
    return { data: [...top, other], total };
  }, [tasks, shownDepartmentIds]);

  // §8.4 — clicking a slice sets the Dashboard's own department filter (the
  // whole page narrows, same as picking it from the dropdown up top)
  // instead of navigating away. Clicking the same slice again clears it
  // (toggle) rather than getting stuck filtered until "ล้างตัวกรอง" is found.
  // "อื่นๆ" isn't one real department, so it falls back to a plain link into
  // the task board instead of pretending to filter to it.
  function goToDepartment(id: string) {
    if (id === "other") {
      router.push("/tasks");
      return;
    }
    setDepartmentId(departmentId === id ? "all" : id);
  }

  return (
    <Card className={`${DASHBOARD_CARD} h-full`}>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          ผลงานแยกตามแผนก
          <span className="flex items-center gap-1 text-[10px] font-medium text-[var(--brand-green-dark)] bg-green-50 rounded-full px-2 py-0.5">
            <KanbanSquare className="h-3 w-3" /> งาน
          </span>
        </CardTitle>
        <p className="text-xs text-[var(--ink-soft)]">งานที่ทำเสร็จของแต่ละแผนก · คลิกชิ้นเพื่อกรองทั้งแดชบอร์ดเฉพาะแผนกนั้น (คลิกซ้ำเพื่อยกเลิก)</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 @container">
        {total === 0 ? (
          <p className="text-sm text-[var(--ink-soft)] text-center py-16">ยังไม่มีงานที่ทำเสร็จในช่วงเวลานี้</p>
        ) : (
          // @container, not `sm:` — see report-feed-department-pie.tsx for
          // why: this card can be resized to span 1/3 of the grid, and a
          // viewport breakpoint doesn't know that.
          <div className="flex flex-col @sm:flex-row items-center gap-4 @sm:gap-6">
            <div className="h-[180px] w-[180px] @sm:h-[200px] @sm:w-[200px] shrink-0 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="completedTasks"
                    nameKey="department"
                    innerRadius={62}
                    outerRadius={92}
                    paddingAngle={1}
                    stroke="#ffffff"
                    strokeWidth={2}
                    isAnimationActive
                    animationDuration={500}
                    activeShape={renderActiveShape}
                  >
                    {data.map((d) => (
                      <Cell
                        key={d.id}
                        fill={d.color}
                        cursor="pointer"
                        opacity={hoveredId && hoveredId !== d.id ? 0.55 : 1}
                        style={{ transition: "opacity 0.12s ease" }}
                        onMouseEnter={() => setHoveredId(d.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onClick={() => goToDepartment(d.id)}
                        tabIndex={0}
                        role="button"
                        aria-pressed={departmentId === d.id}
                        aria-label={`${d.department} — ${d.completedTasks} งาน, ${d.percent}% ของทั้งหมด${departmentId === d.id ? " (กำลังกรองอยู่ คลิกเพื่อยกเลิก)" : ""}`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            goToDepartment(d.id);
                          }
                        }}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    trigger={hasHover ? "hover" : "click"}
                    content={
                      <ChartTooltip<DeptSlice>
                        renderRow={(d) => ({
                          color: d.color,
                          title: d.department,
                          lines: [
                            `${d.completedTasks} งาน · ${d.percent}% ของทั้งหมด`,
                            ...(d.lateTasks > 0 ? [`เลยกำหนด ${d.lateTasks}`] : []),
                          ],
                        })}
                      />
                    }
                    wrapperStyle={{ zIndex: 50, outline: "none" }}
                    allowEscapeViewBox={{ x: true, y: true }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-semibold tabular-nums">{total}</span>
                <span className="text-[11px] text-[var(--ink-soft)]">งาน</span>
              </div>
            </div>

            <div className="flex-1 w-full space-y-1.5 min-w-0">
              {data.map((d) => (
                <button
                  key={d.id}
                  onClick={() => goToDepartment(d.id)}
                  onMouseEnter={() => setHoveredId(d.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  aria-pressed={departmentId === d.id}
                  className={cn(
                    "w-full flex items-center justify-between text-sm gap-2 rounded-lg px-2 py-1.5 -mx-2 hover:bg-[var(--bg-soft)] transition-colors text-left",
                    departmentId === d.id && "bg-[var(--accent)] ring-1 ring-inset ring-[var(--brand-green)]/40"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="text-[var(--ink)] truncate">{d.department}</span>
                  </div>
                  <span className="text-[var(--ink-soft)] tabular-nums shrink-0 whitespace-nowrap">
                    {d.completedTasks} · {d.percent}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
