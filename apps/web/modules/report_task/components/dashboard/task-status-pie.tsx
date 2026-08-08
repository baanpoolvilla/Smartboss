"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { statusCounts } from "@/modules/report_task/lib/reports";
import { statusColors } from "@/modules/report_task/lib/chart-colors";
import { statusMeta } from "@/modules/report_task/lib/task-meta";
import { useDashboardTasks } from "@/modules/report_task/hooks/use-dashboard-tasks";
import { useTaskBoardIntentStore } from "@/modules/report_task/store/task-board-intent-store";
import { ArrowUpRight } from "lucide-react";
import type { TaskStatus } from "@/modules/report_task/types";

const statusOrder: TaskStatus[] = ["todo", "in_progress", "done"];

/** "Task Overview" — the Analytics section's left twin (Report Overview is its right-hand pair). Large donut + legend + a one-line summary + "ดูรายละเอียด" through to the full Task report. */
export function TaskStatusPie() {
  const tasks = useDashboardTasks();
  const router = useRouter();
  const setScrollToStatus = useTaskBoardIntentStore((s) => s.setScrollToStatus);
  const { data, total, completionRate } = useMemo(() => {
    const counts = statusCounts(tasks);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const data = statusOrder.map((status) => ({
      status,
      label: statusMeta[status].label,
      value: counts[status],
      percent: total ? Math.round((counts[status] / total) * 100) : 0,
    }));
    return { data, total, completionRate: total ? Math.round((counts.done / total) * 100) : 0 };
  }, [tasks]);

  function goToStatus(status: TaskStatus) {
    setScrollToStatus(status);
    router.push("/tasks");
  }

  return (
    <Card className={`${DASHBOARD_CARD} h-full`}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">ภาพรวมงาน</CardTitle>
        <p className="text-[13px] text-[var(--ink-soft)]">สถานะงานทั้งหมด · คลิกเพื่อดูคอลัมน์นั้นในบอร์ดงาน</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
          <div className="h-[180px] w-[180px] sm:h-[220px] sm:w-[220px] shrink-0 relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={70}
                  outerRadius={102}
                  paddingAngle={2}
                  cornerRadius={5}
                  stroke="#ffffff"
                  strokeWidth={2}
                  isAnimationActive
                  animationDuration={500}
                >
                  {data.map((d) => (
                    <Cell
                      key={d.status}
                      fill={statusColors[d.status]}
                      cursor="pointer"
                      onClick={() => goToStatus(d.status)}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, _name, item) => [`${value} งาน (${item.payload.percent}%)`, item.payload.label]}
                  wrapperStyle={{ zIndex: 50, outline: "none" }}
                  allowEscapeViewBox={{ x: true, y: true }}
                  contentStyle={{ borderRadius: 8, borderColor: "var(--line)", fontSize: 13, background: "#fff", boxShadow: "0 8px 24px -8px rgba(17,17,17,0.22)" }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-4xl font-semibold tabular-nums">{completionRate}%</span>
              <span className="text-[13px] text-[var(--ink-soft)] mt-0.5">เสร็จสิ้น</span>
            </div>
          </div>

          <div className="flex-1 w-full space-y-1.5 min-w-0">
            {data.map((d) => (
              <button
                key={d.status}
                onClick={() => goToStatus(d.status)}
                className="w-full flex items-center justify-between text-sm gap-2 rounded-lg px-2 py-1.5 -mx-2 hover:bg-[var(--bg-soft)] transition-colors text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: statusColors[d.status] }} />
                  <span className="text-[var(--ink)] whitespace-nowrap">{d.label}</span>
                </div>
                <span className="text-[var(--ink-soft)] tabular-nums shrink-0">
                  {d.value} · {d.percent}%
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-4 border-t border-[var(--line)]">
          <p className="text-[13px] text-[var(--ink-soft)]">
            ทั้งหมด <span className="font-semibold text-[var(--ink)] tabular-nums">{total}</span> งาน
          </p>
          <button
            onClick={() => router.push("/reports")}
            className="flex items-center gap-1 text-[13px] font-semibold text-[var(--brand-green-dark)] hover:underline"
          >
            ดูรายละเอียด <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
