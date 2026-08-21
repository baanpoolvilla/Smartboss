"use client";

import { useMemo } from "react";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { useTaskStore, type QuickView } from "@/modules/report_task/store/task-store";
import { cn } from "@/modules/report_task/lib/utils";
import type { Task } from "@/modules/report_task/types";
import { ListTodo, CircleDot, PlayCircle, AlarmClockOff, Hourglass, CheckCircle2 } from "lucide-react";

/**
 * Quick at-a-glance stats for the board currently open — scoped to whatever
 * `tasks` the caller passes in (already run through `matchesTaskFilters`
 * minus `quickView`, so the numbers track every *other* active filter but
 * don't collapse onto each other once one chip is clicked — see task-store's
 * `QuickView` doc comment). Each chip doubles as a one-click drill-down
 * filter for the board underneath (toggle off by clicking it again).
 *
 * Small pill chips in one wrapping row, not the old 4 big `<Card>` boxes —
 * but still one independent element per chip (a plain `flex flex-wrap`, no
 * shared background/divider trick). Worth noting: 3 earlier attempts to
 * merge these into a single unified panel (gap-px+shared-bg, divide-x/y, an
 * earlier flex-chip-row) all passed build clean but broke on production for
 * reasons that were never pinned down (no DB in this sandbox to reproduce
 * against) — every one of those got reverted back to separate boxes. This
 * keeps that same "separate element per stat" shape, just restyled smaller;
 * verify on the real deployment before trusting it further.
 */
export function TaskBoardKpis({ tasks }: { tasks: Task[] }) {
  const quickView = useTaskStore((s) => s.filters.quickView);
  const setFilters = useTaskStore((s) => s.setFilters);

  const stats = useMemo(
    () => ({
      total: tasks.length,
      todo: tasks.filter((t) => t.status === "todo").length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      overdue: tasks.filter((t) => t.status !== "done" && dueUrgency(t) === "overdue").length,
      review: tasks.filter((t) => t.status === "done" && !t.reviewedBy).length,
      doneAll: tasks.filter((t) => t.status === "done" && !!t.reviewedBy).length,
    }),
    [tasks]
  );

  function toggle(key: QuickView) {
    setFilters({ quickView: quickView === key ? "all" : key });
  }

  const chips: { key: QuickView; label: string; value: number; icon: typeof ListTodo; iconClass: string }[] = [
    { key: "all", label: "ทั้งหมด", value: stats.total, icon: ListTodo, iconClass: "bg-slate-50 text-[var(--chart-gray)]" },
    { key: "todo", label: "รอดำเนินการ", value: stats.todo, icon: CircleDot, iconClass: "bg-slate-50 text-[var(--chart-gray)]" },
    { key: "inProgress", label: "กำลังทำ", value: stats.inProgress, icon: PlayCircle, iconClass: "bg-amber-50 text-[var(--chart-amber)]" },
    { key: "overdue", label: "เลยกำหนด", value: stats.overdue, icon: AlarmClockOff, iconClass: "bg-red-50 text-[var(--chart-red)]" },
    { key: "review", label: "รอตรวจสอบ", value: stats.review, icon: Hourglass, iconClass: "bg-green-50 text-[var(--chart-green)]" },
    { key: "done", label: "เสร็จสิ้น", value: stats.doneAll, icon: CheckCircle2, iconClass: "bg-green-100 text-[var(--brand-green-dark)]" },
  ];

  return (
    // <640px: one horizontally-scrolling row (scrollbar hidden, native
    // touch-swipe) instead of wrapping to a 2nd/3rd line — wrapping is what
    // was pushing the header tall enough to push the first card below the
    // fold on a phone. ≥640px keeps the original wrapping row.
    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [-webkit-overflow-scrolling:touch] sm:flex-wrap sm:overflow-visible">
      {chips.map((c) => {
        // "ทั้งหมด" is the resting/no-filter state — quickView defaults to
        // "all", so highlighting it here would make it look permanently
        // "selected" even when nothing's actually drilled down.
        const active = c.key !== "all" && quickView === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => toggle(c.key)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--line)] bg-white py-1 pl-1 pr-2.5 transition-colors hover:bg-[var(--bg-soft)]",
              active && "ring-2 ring-inset ring-[var(--brand-green)]"
            )}
          >
            <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", c.iconClass)}>
              <c.icon className="h-3 w-3" />
            </span>
            <span className="text-[11px] text-[var(--ink-soft)]">{c.label}</span>
            <span className="text-[13px] font-bold tabular-nums text-[var(--ink)]">{c.value}</span>
          </button>
        );
      })}
    </div>
  );
}
