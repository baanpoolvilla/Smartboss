"use client";

import { CalendarClock, CalendarDays, CalendarX2 } from "lucide-react";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { formatShortDate, daysUntil } from "@/modules/report_task/lib/format";
import { cn } from "@/modules/report_task/lib/utils";
import type { Task } from "@/modules/report_task/types";

/**
 * Due date as a compact, single-line chip with a calendar icon. Normal dates read
 * quietly; "soon" turns amber and "overdue" turns red with a "เลย N วัน" tail so
 * the slip is obvious at a glance — never wrapping to two lines.
 */
export function DueDateBadge({ task, className }: { task: Task; className?: string }) {
  const urgency = dueUrgency(task);
  const date = formatShortDate(task.dueDate);

  if (urgency === "normal") {
    // "กำหนดส่ง" spelled out here, unlike the soon/overdue chips below — those
    // already read as a due date from their red/amber coloring and lateness
    // tail alone, but a plain-styled date (esp. on a "เสร็จสิ้น" card, where
    // there's no other date on the card to contrast it against) is otherwise
    // ambiguous about which date it even is.
    return (
      <span className={cn("inline-flex items-center gap-1 text-[11px] text-[var(--ink)] whitespace-nowrap", className)}>
        <CalendarDays className="h-3 w-3" />
        กำหนดส่ง {date}
      </span>
    );
  }

  if (urgency === "soon") {
    const left = daysUntil(task.dueDate);
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md whitespace-nowrap",
          "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
          className
        )}
      >
        <CalendarClock className="h-3 w-3" />
        {date}
        <span className="opacity-70">· {left === 0 ? "วันนี้" : `อีก ${left} ว`}</span>
      </span>
    );
  }

  // overdue
  const over = Math.abs(daysUntil(task.dueDate));
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-medium pl-1.5 pr-1 py-0.5 rounded-md whitespace-nowrap",
        "bg-red-50 text-red-600 ring-1 ring-inset ring-red-200",
        className
      )}
    >
      <CalendarX2 className="h-3 w-3" />
      {date}
      <span className="ml-0.5 rounded bg-red-600 text-white font-semibold px-1 py-px tabular-nums">เลย {over} ว</span>
    </span>
  );
}
