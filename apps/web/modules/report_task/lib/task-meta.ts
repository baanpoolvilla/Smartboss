import type { TaskPriority, TaskStatus } from "@/modules/report_task/types";
import { chartColors } from "@/modules/report_task/lib/chart-colors";
import { CheckCircle2, CircleDot, type LucideIcon } from "lucide-react";

// Traffic-light progression: red (hasn't moved yet) → yellow (in motion) →
// green (done) — the same read-at-a-glance language as the priority colors.
export const statusMeta: Record<
  TaskStatus,
  { label: string; dot: string; accentColor: string; badgeClass: string; column: string }
> = {
  todo: {
    label: "รอดำเนินการ",
    dot: "bg-[var(--chart-red)]",
    accentColor: "var(--chart-red)",
    badgeClass: "bg-red-50 text-red-700 border-red-200",
    column: "border-t-[var(--chart-red)]",
  },
  in_progress: {
    label: "กำลังทำ",
    dot: "bg-[var(--chart-amber)]",
    accentColor: "var(--chart-amber)",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
    column: "border-t-[var(--chart-amber)]",
  },
  done: {
    label: "เสร็จสิ้น",
    dot: "bg-[var(--brand-green)]",
    accentColor: "var(--brand-green)",
    badgeClass: "bg-green-50 text-green-700 border-green-200",
    column: "border-t-[var(--brand-green)]",
  },
};

// No per-priority icon shape on purpose — four priorities read faster as a
// single consistent color language (dot/left-border/badge tint) than as four
// different glyphs that only some views got around to coloring.
export const priorityMeta: Record<
  TaskPriority,
  { label: string; badgeClass: string; accentColor: string }
> = {
  critical: { label: "ด่วนมาก", badgeClass: "bg-red-50 text-red-700 border-red-200", accentColor: "var(--chart-red)" },
  high: { label: "สูง", badgeClass: "bg-amber-50 text-amber-700 border-amber-200", accentColor: "var(--chart-amber)" },
  medium: { label: "ปานกลาง", badgeClass: "bg-green-50 text-green-700 border-green-200", accentColor: "var(--chart-green)" },
  low: { label: "ต่ำ", badgeClass: "bg-slate-100 text-slate-600 border-slate-200", accentColor: "var(--chart-gray)" },
};

/**
 * Raw hex mirror of the priority accent colors, for renderers (Recharts,
 * FullCalendar) that can't reliably resolve CSS var() — single source of
 * truth so it can't drift from `priorityMeta[p].accentColor` above.
 */
export const priorityColorHex: Record<TaskPriority, string> = {
  critical: chartColors.red,
  high: chartColors.amber,
  medium: chartColors.green,
  low: chartColors.gray,
};

export const statusIcon: Record<TaskStatus, LucideIcon> = {
  todo: CircleDot,
  in_progress: CircleDot,
  done: CheckCircle2,
};

export const taskStatusOrder: TaskStatus[] = ["todo", "in_progress", "done"];
export const taskPriorityOrder: TaskPriority[] = ["critical", "high", "medium", "low"];
