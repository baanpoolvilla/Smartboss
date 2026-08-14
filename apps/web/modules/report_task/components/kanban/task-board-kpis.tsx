"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/modules/report_task/components/ui/card";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { useTaskStore, type QuickView } from "@/modules/report_task/store/task-store";
import { cn } from "@/modules/report_task/lib/utils";
import type { Task } from "@/modules/report_task/types";
import { ListTodo, PlayCircle, CheckCircle2, Flag } from "lucide-react";

/**
 * Quick at-a-glance stats for the board currently open — scoped to whatever
 * `tasks` the caller passes in (already run through `matchesTaskFilters`
 * minus `quickView`, so the 4 numbers track every *other* active filter but
 * don't collapse onto each other once one card is clicked — see task-store's
 * `QuickView` doc comment). Each card doubles as a one-click drill-down
 * filter for the board underneath (toggle off by clicking it again).
 */
export function TaskBoardKpis({ tasks }: { tasks: Task[] }) {
  const quickView = useTaskStore((s) => s.filters.quickView);
  const setFilters = useTaskStore((s) => s.setFilters);

  const stats = useMemo(
    () => ({
      total: tasks.length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      overdue: tasks.filter((t) => dueUrgency(t) === "overdue" && t.status !== "done").length,
      doneAll: tasks.filter((t) => t.status === "done").length,
    }),
    [tasks]
  );

  function toggle(key: QuickView) {
    setFilters({ quickView: quickView === key ? "all" : key });
  }

  const cards: { key: QuickView; label: string; value: number; icon: typeof ListTodo; accent: string; iconClass: string }[] = [
    { key: "all", label: "งานทั้งหมด", value: stats.total, icon: ListTodo, accent: "border-t-[var(--chart-gray)]", iconClass: "bg-slate-50 text-[var(--chart-gray)]" },
    { key: "inProgress", label: "กำลังทำ", value: stats.inProgress, icon: PlayCircle, accent: "border-t-[var(--chart-amber)]", iconClass: "bg-amber-50 text-[var(--chart-amber)]" },
    { key: "overdue", label: "เลยกำหนด", value: stats.overdue, icon: Flag, accent: "border-t-[var(--chart-red)]", iconClass: "bg-red-50 text-[var(--chart-red)]" },
    { key: "done", label: "สำเร็จทั้งหมด", value: stats.doneAll, icon: CheckCircle2, accent: "border-t-[var(--chart-green)]", iconClass: "bg-green-50 text-[var(--chart-green)]" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((c) => {
        // "งานทั้งหมด" is the resting/no-filter state — quickView defaults to
        // "all", so highlighting it here would make it look permanently
        // "selected" even when nothing's actually drilled down.
        const active = c.key !== "all" && quickView === c.key;
        return (
          <Card
            key={c.key}
            role="button"
            tabIndex={0}
            onClick={() => toggle(c.key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle(c.key);
              }
            }}
            className={cn(
              "border-[var(--line)] border-t-2 shadow-sm cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md",
              c.accent,
              active && "ring-2 ring-inset ring-[var(--brand-green)]"
            )}
          >
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
        );
      })}
    </div>
  );
}
