"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from "recharts";
import type { PieSectorDataItem } from "recharts/types/polar/Pie";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { departments, getUser } from "@/modules/report_task/lib/directory";
import { buildDepartmentComplianceReports, trackedTopicsOf } from "@/modules/report_task/lib/report-feed-compliance";
import { useVisibleReportTopics } from "@/modules/report_task/hooks/use-visible-report-topics";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { chartGray, departmentColorOrder } from "@/modules/report_task/lib/chart-colors";
import { useHasHover } from "@/modules/report_task/hooks/use-has-hover";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { presetRange } from "@/modules/report_task/lib/date-filter";
import { ChartTooltip } from "@/modules/report_task/components/shared/chart-tooltip";
import { cn } from "@/modules/report_task/lib/utils";
import { MessageSquareText } from "lucide-react";

const MAX_SLICES = 5;

interface DeptSlice {
  id: string;
  department: string;
  onTime: number;
  late: number;
  percent: number;
  color: string;
}

// Recharts hands this function a props object that includes a `key` —
// spreading that straight into JSX triggers React's "key must be passed
// directly" warning, so it's pulled out and passed on its own instead.
function renderActiveShape({ key, ...props }: PieSectorDataItem & { key?: React.Key | null }) {
  return <Sector key={key} {...props} outerRadius={(props.outerRadius ?? 0) + 4} />;
}

/**
 * Same shape as DepartmentPieChart but for report-feed compliance — Pie of
 * on-time-post counts per department (a real additive quantity, not a rate)
 * so "who has the most on-time discipline" reads as a graph, not just a
 * table row. Narrows to one department the same way the Task chart does
 * when the Dashboard's person/department picker is set.
 */
export function ReportFeedDepartmentPie() {
  const topics = useVisibleReportTopics();
  const posts = useReportFeedStore((s) => s.posts);
  const personId = useDashboardFilterStore((s) => s.personId);
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const setDepartmentId = useDashboardFilterStore((s) => s.setDepartmentId);
  const preset = useDashboardFilterStore((s) => s.preset);
  const customFrom = useDashboardFilterStore((s) => s.customFrom);
  const customTo = useDashboardFilterStore((s) => s.customTo);
  const range = presetRange(preset, customFrom, customTo);
  const exemptions = useReportComplianceExemptions();
  const router = useRouter();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hasHover = useHasHover();

  const shownDepartmentIds = useMemo(() => {
    if (departmentId !== "all") return new Set([departmentId]);
    if (personId !== "all") {
      const dept = getUser(personId)?.departmentId;
      return dept ? new Set([dept]) : new Set(departments.map((d) => d.id));
    }
    return new Set(departments.map((d) => d.id));
  }, [departmentId, personId]);

  const { data, total } = useMemo(() => {
    const reports = buildDepartmentComplianceReports(topics, posts, range, exemptions);
    const rows = departments
      .filter((d) => shownDepartmentIds.has(d.id))
      .map((d) => {
        const r = reports.find((rep) => rep.id === d.id);
        return {
          id: d.id,
          department: d.name,
          onTime: r?.onTime ?? 0,
          late: r?.late ?? 0,
          trackedDays: r?.trackedDays ?? 0,
          onTimeRate: r?.onTimeRate ?? 0,
        };
      })
      .filter((d) => d.trackedDays > 0)
      .sort((a, b) => b.onTime - a.onTime);

    const total = rows.reduce((sum, r) => sum + r.onTime, 0);
    const withPercent = (r: (typeof rows)[number], color: string) => ({
      ...r,
      color,
      percent: total ? Math.round((r.onTime / total) * 100) : 0,
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
        onTime: rest.reduce((s, r) => s + r.onTime, 0),
        late: rest.reduce((s, r) => s + r.late, 0),
        trackedDays: 0,
        onTimeRate: 0,
      },
      chartGray
    );
    return { data: [...top, other], total };
  }, [topics, posts, range, shownDepartmentIds, exemptions]);

  const hasTrackedRooms = trackedTopicsOf(topics).length > 0;

  // §8.4 — same toggle-filter behavior as DepartmentPieChart: clicking sets
  // (or, on the same slice again, clears) the Dashboard's department filter
  // instead of navigating away. "อื่นๆ" isn't one real department, so it
  // stays a plain link into report-feed.
  function goToDepartment(id: string) {
    if (id === "other") {
      router.push("/report-feed");
      return;
    }
    setDepartmentId(departmentId === id ? "all" : id);
  }

  return (
    <Card className={`${DASHBOARD_CARD} h-full`}>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          การส่งรายงานแยกตามแผนก
          <span className="flex items-center gap-1 text-[10px] font-medium text-[var(--brand-green-dark)] bg-green-50 rounded-full px-2 py-0.5">
            <MessageSquareText className="h-3 w-3" /> Report
          </span>
        </CardTitle>
        <p className="text-xs text-[var(--ink-soft)]">จำนวนครั้งที่ส่งตรงเวลาของแต่ละแผนก · คลิกชิ้นเพื่อกรองทั้งแดชบอร์ดเฉพาะแผนกนั้น (คลิกซ้ำเพื่อยกเลิก)</p>
      </CardHeader>
      <CardContent className="@container">
        {/* `data.length === 0` alone missed the case where tracked rooms
            exist and have rows, but every row's onTime is 0 (nothing sent
            on time yet this range) — `total === 0` too, matching
            DepartmentPieChart, catches that the same way. Without it this
            rendered a 0-value donut (no visible ring, "0 ครั้ง" center) next
            to a legend of "department · 0 · 0%" rows instead of a clean
            empty state. */}
        {!hasTrackedRooms || total === 0 ? (
          <p className="text-sm text-[var(--ink-soft)] text-center py-16">
            {hasTrackedRooms ? "ยังไม่มีข้อมูลในช่วงเวลานี้" : "ยังไม่มีห้องที่ตั้งรอบเวลา (cutoff) — ตั้งค่าได้ที่ ตั้งค่า > ห้อง Report"}
          </p>
        ) : (
          // @container, not `sm:` — this card can be resized to span 1/3 of
          // the grid via "ปรับแต่ง", and at span 1 it's ~350px wide even on
          // a wide desktop viewport. A viewport breakpoint doesn't know
          // that; it kept switching to the side-by-side donut+legend layout
          // (and the donut's full 200px size) based on the *window* being
          // wide, squeezing the legend column down to almost nothing and
          // truncating every department name to 1-2 characters.
          <div className="flex flex-col @sm:flex-row items-center gap-4 @sm:gap-6">
            <div className="h-[180px] w-[180px] @sm:h-[200px] @sm:w-[200px] shrink-0 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="onTime"
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
                        aria-label={`${d.department} — ตรงเวลา ${d.onTime} ครั้ง, ${d.percent}% ของทั้งหมด${departmentId === d.id ? " (กำลังกรองอยู่ คลิกเพื่อยกเลิก)" : ""}`}
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
                            `ตรงเวลา ${d.onTime} ครั้ง · ${d.percent}% ของทั้งหมด`,
                            ...(d.late > 0 ? [`ส่งช้า ${d.late}`] : []),
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
                <span className="text-[11px] text-[var(--ink-soft)]">ครั้ง</span>
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
                    {d.onTime} ครั้ง ({d.percent}%)
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
