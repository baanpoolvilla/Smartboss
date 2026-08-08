import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { getUser } from "@/modules/report_task/data/mock";
import type { Task } from "@/modules/report_task/types";
import type { PenaltyFilter } from "@/modules/report_task/store/task-store";

export interface TaskFilterState {
  search: string;
  assigneeId: string | "all";
  departmentId: string | "all";
  priority: string;
  penalty: PenaltyFilter;
}

/** Shared board/grid/penalty filter predicate — one source of truth. */
export function matchesTaskFilters(task: Task, filters: TaskFilterState): boolean {
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const inTitle = task.title.toLowerCase().includes(q);
    const inDescription = task.description.toLowerCase().includes(q);
    const inAssignee = task.assigneeIds.some((id) => getUser(id)?.name.toLowerCase().includes(q));
    if (!inTitle && !inDescription && !inAssignee) return false;
  }
  if (filters.assigneeId !== "all" && !task.assigneeIds.includes(filters.assigneeId)) return false;
  if (filters.departmentId !== "all" && !task.departmentIds.includes(filters.departmentId)) return false;
  if (filters.priority !== "all" && task.priority !== filters.priority) return false;
  if (filters.penalty !== "all") {
    const overdue = dueUrgency(task) === "overdue";
    if (filters.penalty === "overdue" && !overdue) return false;
    if (filters.penalty === "pending" && !(overdue && !task.penalty)) return false;
    if (filters.penalty === "docked" && !task.penalty) return false;
  }
  return true;
}
