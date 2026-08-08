"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/modules/report_task/components/ui/card";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { todayIso } from "@/modules/report_task/lib/now";
import { cn } from "@/modules/report_task/lib/utils";
import type { Task } from "@/modules/report_task/types";
import { ListTodo, PlayCircle, CheckCircle2, Flag } from "lucide-react";

/**
 * Quick at-a-glance stats for the board currently open — scoped to whatever
 * `tasks` the caller passes in, so it already respects the same visibility
 * rules (canSeeTask) as the board itself, not a separate company-wide count.
 */
export function TaskBoardKpis({ tasks }: { tasks: Task[] }) {
  const stats = useMemo(() => {
    const today = todayIso();
    return {
      total: tasks.length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      overdue: tasks.filter((t) => dueUrgency(t) === "overdue").length,
      doneToday: tasks.filter((t) => t.status === "done" && t.updatedAt.slice(0, 10) === today).length,
    };
  }, [tasks]);

  const cards = [
    { label: "งานทั้งหมด", value: stats.total, icon: ListTodo, accent: "border-t-[var(--chart-blue)]", iconClass: "bg-blue-50 text-[var(--chart-blue)]" },
    { label: "กำลังทำ", value: stats.inProgress, icon: PlayCircle, accent: "border-t-[var(--chart-amber)]", iconClass: "bg-amber-50 text-[var(--chart-amber)]" },
    { label: "เลยกำหนด", value: stats.overdue, icon: Flag, accent: "border-t-[var(--chart-red)]", iconClass: "bg-red-50 text-[var(--chart-red)]" },
    { label: "เสร็จวันนี้", value: stats.doneToday, icon: CheckCircle2, accent: "border-t-[var(--brand-green)]", iconClass: "bg-green-50 text-[var(--brand-green)]" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((c) => (
        <Card key={c.label} className={cn("border-[var(--line)] border-t-2 shadow-sm", c.accent)}>
          <CardContent className="flex items-center gap-3 px-4 py-2.5">
            <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", c.iconClass)}>
              <c.icon className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <p className="text-xl font-semibold tracking-tight tabular-nums leading-none">{c.value}</p>
              <p className="text-[11px] text-[var(--ink-soft)] mt-1 truncate">{c.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
