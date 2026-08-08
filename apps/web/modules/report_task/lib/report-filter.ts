import { useMemo } from "react";
import { useVisibleTasks } from "@/modules/report_task/hooks/use-visible-tasks";
import { useReportFilterStore, type ReportDim } from "@/modules/report_task/store/report-filter-store";
import { getDepartment, getUser } from "@/modules/report_task/data/mock";
import { priorityMeta } from "@/modules/report_task/lib/task-meta";
import { presetRange } from "@/modules/report_task/lib/date-filter";
import { segmentMeta, segmentOf, type ProgressSegment } from "@/modules/report_task/lib/report-charts";
import type { Task, TaskPriority } from "@/modules/report_task/types";

export function applyReportFilter(tasks: Task[], dim: ReportDim | null, value: string | null): Task[] {
  if (!dim || !value) return tasks;
  switch (dim) {
    case "status":
      return tasks.filter((t) => segmentOf(t) === value);
    case "priority":
      return tasks.filter((t) => t.priority === value);
    case "department":
      return tasks.filter((t) => t.departmentIds.includes(value));
    case "member":
      return tasks.filter((t) => t.assigneeIds.includes(value));
  }
}

/**
 * Cross-filter rule: every part of the report narrows to the active selection —
 * except the facet you're filtering BY, which keeps showing all its options (so
 * you can switch or clear from it). Pass the component's own dimension.
 *
 * Base pool is canSeeTask-scoped (via useVisibleTasks) — Reports is manager-
 * only, but a department head's report still only ever covers their own
 * department, never the whole company (that's owner-only).
 */
export function useReportTasks(myDim?: ReportDim): Task[] {
  const tasks = useVisibleTasks();
  const dim = useReportFilterStore((s) => s.dim);
  const value = useReportFilterStore((s) => s.value);
  const preset = useReportFilterStore((s) => s.preset);
  const customFrom = useReportFilterStore((s) => s.customFrom);
  const customTo = useReportFilterStore((s) => s.customTo);
  return useMemo(() => {
    const range = presetRange(preset, customFrom, customTo);
    const dateScoped = range
      ? tasks.filter((t) => {
          const due = new Date(t.dueDate).getTime();
          return due >= range.from.getTime() && due <= range.to.getTime();
        })
      : tasks;
    if (!dim || dim === myDim) return dateScoped;
    return applyReportFilter(dateScoped, dim, value);
  }, [tasks, dim, value, myDim, preset, customFrom, customTo]);
}

/** The active value for a given facet, or null (used to highlight the selected row). */
export function useActiveValue(myDim: ReportDim): string | null {
  const dim = useReportFilterStore((s) => s.dim);
  const value = useReportFilterStore((s) => s.value);
  return dim === myDim ? value : null;
}

const dimLabel: Record<ReportDim, string> = {
  status: "สถานะ",
  priority: "ความสำคัญ",
  department: "แผนก",
  member: "ผู้รับผิดชอบ",
};

export function reportFilterLabel(dim: ReportDim, value: string): { dim: string; value: string } {
  let v = value;
  if (dim === "status") v = segmentMeta[value as ProgressSegment]?.label ?? value;
  else if (dim === "priority") v = priorityMeta[value as TaskPriority]?.label ?? value;
  else if (dim === "department") v = getDepartment(value)?.name ?? value;
  else if (dim === "member") v = getUser(value)?.name ?? value;
  return { dim: dimLabel[dim], value: v };
}
