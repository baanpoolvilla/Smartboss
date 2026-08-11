import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { presetRange, type DatePreset } from "@/modules/report_task/lib/date-filter";
import type { Task } from "@/modules/report_task/types";
import type { PenaltyFilter, QuickView } from "@/modules/report_task/store/task-store";

export interface TaskFilterState {
  assigneeId: string | "all";
  departmentId: string | "all";
  priority: string;
  penalty: PenaltyFilter;
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  quickView: QuickView;
}

/** Shared board/grid/penalty filter predicate — one source of truth. */
export function matchesTaskFilters(task: Task, filters: TaskFilterState): boolean {
  if (filters.assigneeId !== "all" && !task.assigneeIds.includes(filters.assigneeId)) return false;
  if (filters.departmentId !== "all" && !task.departmentIds.includes(filters.departmentId)) return false;
  if (filters.priority !== "all" && task.priority !== filters.priority) return false;
  if (filters.penalty !== "all") {
    const overdue = dueUrgency(task) === "overdue";
    if (filters.penalty === "overdue" && !overdue) return false;
    if (filters.penalty === "pending" && !(overdue && !task.penalty)) return false;
    if (filters.penalty === "docked" && !task.penalty) return false;
  }
  const range = presetRange(filters.preset, filters.customFrom, filters.customTo);
  if (range) {
    const due = new Date(task.dueDate).getTime();
    if (due < range.from.getTime() || due > range.to.getTime()) return false;
  }
  if (filters.quickView !== "all") {
    if (filters.quickView === "inProgress" && task.status !== "in_progress") return false;
    if (filters.quickView === "overdue" && dueUrgency(task) !== "overdue") return false;
    if (filters.quickView === "done" && task.status !== "done") return false;
  }
  return true;
}
