"use client";

import { useMemo } from "react";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { useTaskStore, type QuickView } from "@/modules/report_task/store/task-store";
import { cn } from "@/modules/report_task/lib/utils";
import type { Task } from "@/modules/report_task/types";

/**
 * Quick at-a-glance stats for the board currently open — scoped to whatever
 * `tasks` the caller passes in (already run through `matchesTaskFilters`
 * minus `quickView`, so the 4 numbers track every *other* active filter but
 * don't collapse onto each other once one chip is clicked — see task-store's
 * `QuickView` doc comment). Each chip doubles as a one-click drill-down
 * filter for the board underneath (toggle off by clicking it again).
 *
 * A single scrolling chip row, not the 4-separate-Card grid this replaced —
 * two earlier attempts at a single "sheet" both used `grid`/`divide-x`
 * classes layered directly onto the `Card` component (overriding its own
 * `flex`/gap/padding root classes) and both rendered blank in production for
 * reasons never pinned down (no local DB in that sandbox to debug against).
 * This sidesteps the whole failure class instead of retrying it more
 * carefully: no `Card`, no grid, no breakpoint-dependent column count — just
 * a plain flex row that overflow-scrolls if it doesn't fit, identical
 * markup at every viewport width.
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

  const chips: { key: QuickView; label: string; value: number; dotClass: string }[] = [
    { key: "all", label: "งานทั้งหมด", value: stats.total, dotClass: "bg-[var(--chart-gray)]" },
    { key: "inProgress", label: "กำลังทำ", value: stats.inProgress, dotClass: "bg-[var(--chart-amber)]" },
    { key: "overdue", label: "เลยกำหนด", value: stats.overdue, dotClass: "bg-[var(--chart-red)]" },
    { key: "done", label: "สำเร็จทั้งหมด", value: stats.doneAll, dotClass: "bg-[var(--chart-green)]" },
  ];

  return (
    <div className="flex gap-1.5 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--bg)] p-1.5 shadow-sm">
      {chips.map((c) => {
        // "งานทั้งหมด" is the resting/no-filter state — quickView defaults to
        // "all", so highlighting it here would make it look permanently
        // "selected" even when nothing's actually drilled down.
        const active = c.key !== "all" && quickView === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => toggle(c.key)}
            aria-pressed={active}
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--bg-soft)] px-3 py-1.5 text-left transition-colors hover:bg-[var(--accent)]",
              active && "ring-1 ring-inset ring-[var(--brand-green)]"
            )}
          >
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", c.dotClass)} />
            <span className="text-[13.5px] font-semibold tabular-nums leading-none">{c.value}</span>
            <span className="text-[11.5px] text-[var(--ink-soft)]">{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}
