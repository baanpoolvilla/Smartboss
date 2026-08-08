"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { departments, getUser } from "@/modules/report_task/data/mock";
import { buildDepartmentReports } from "@/modules/report_task/lib/reports";
import { departmentColorOrder, chartChrome } from "@/modules/report_task/lib/chart-colors";
import { useDashboardTasks } from "@/modules/report_task/hooks/use-dashboard-tasks";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { useTaskBoardIntentStore } from "@/modules/report_task/store/task-board-intent-store";
import { KanbanSquare } from "lucide-react";

export function DepartmentBarChart() {
  const tasks = useDashboardTasks();
  const personId = useDashboardFilterStore((s) => s.personId);
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const router = useRouter();
  const setDepartment = useTaskBoardIntentStore((s) => s.setDepartment);
  const setScrollToStatus = useTaskBoardIntentStore((s) => s.setScrollToStatus);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // A department or person filter narrows this chart's own tasks down to one
  // department already — showing every other department's (now-empty) bar
  // alongside it read as "no data" instead of "not selected". Narrow the bars
  // themselves to match instead of leaving the rest of the company on the axis.
  const shownDepartmentIds = useMemo(() => {
    if (departmentId !== "all") return new Set([departmentId]);
    if (personId !== "all") {
      const dept = getUser(personId)?.departmentId;
      return dept ? new Set([dept]) : new Set(departments.map((d) => d.id));
    }
    return new Set(departments.map((d) => d.id));
  }, [departmentId, personId]);

  const data = useMemo(() => {
    const reports = buildDepartmentReports(tasks);
    // Color keyed off each department's fixed position in the full company
    // list, not its position in this (possibly filtered-down) array — otherwise
    // narrowing to one department always lands it on index 0's color (blue).
    return departments
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => shownDepartmentIds.has(d.id))
      .map(({ d, i }) => {
        const r = reports.find((rep) => rep.departmentId === d.id)!;
        return {
          id: d.id,
          department: d.name,
          completionRate: r.completionRate,
          color: departmentColorOrder[i % departmentColorOrder.length],
        };
      });
  }, [tasks, shownDepartmentIds]);

  function goToDepartment(departmentId: string) {
    setDepartment(departmentId);
    // The bar itself is a "% done" stat, not "all tasks" — landing on a wall
    // of 18 mixed-status cards didn't match what was just clicked, so scroll
    // to and ring-highlight the "เสร็จสิ้น" column specifically instead.
    setScrollToStatus("done");
    router.push("/tasks");
  }

  return (
    <Card className={`${DASHBOARD_CARD} h-full`}>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          ผลงานแยกตามแผนก
          <span className="flex items-center gap-1 text-[10px] font-medium text-[var(--chart-blue)] bg-blue-50 rounded-full px-2 py-0.5">
            <KanbanSquare className="h-3 w-3" /> งาน
          </span>
        </CardTitle>
        <p className="text-xs text-[var(--ink-soft)]">% งานที่ทำเสร็จของแต่ละแผนก (สูง = เสร็จไปเยอะ) · คลิกแท่งกราฟเพื่อดูงานของแผนกนั้นในบอร์ดงาน</p>
      </CardHeader>
      <CardContent>
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={chartChrome.grid} />
              <XAxis
                dataKey="department"
                tick={{ fontSize: 11, fill: chartChrome.mutedText }}
                axisLine={{ stroke: chartChrome.axis }}
                tickLine={false}
                interval={0}
                angle={-20}
                textAnchor="end"
                height={50}
              />
              <YAxis
                tick={{ fontSize: 11, fill: chartChrome.mutedText }}
                axisLine={false}
                tickLine={false}
                width={44}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                cursor={{ fill: "var(--bg-soft)" }}
                formatter={(value) => [`${value}%`, "งานเสร็จ"]}
                labelFormatter={(label) => `แผนก${label}`}
                wrapperStyle={{ zIndex: 50, outline: "none" }}
                contentStyle={{ borderRadius: 8, borderColor: "var(--line)", fontSize: 13, background: "#fff", boxShadow: "0 8px 24px -8px rgba(17,17,17,0.22)" }}
              />
              <Bar dataKey="completionRate" radius={[4, 4, 0, 0]} maxBarSize={40}>
                <LabelList
                  dataKey="completionRate"
                  position="top"
                  formatter={(v) => `${v}%`}
                  style={{ fontSize: 11, fill: chartChrome.mutedText, fontWeight: 600 }}
                />
                {data.map((d) => (
                  <Cell
                    key={d.department}
                    fill={d.color}
                    cursor="pointer"
                    opacity={hoveredId && hoveredId !== d.id ? 0.35 : 1}
                    style={{ transition: "opacity 0.12s ease" }}
                    onMouseEnter={() => setHoveredId(d.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => goToDepartment(d.id)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
