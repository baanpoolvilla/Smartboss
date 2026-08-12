import type { Task } from "@/modules/report_task/types";
import { daysUntil } from "@/modules/report_task/lib/format";

export type DueUrgency = "overdue" | "soon" | "normal";

/**
 * overdue: past the (possibly revised) due date and not done — dark red.
 * soon: due within the next 0-2 days — amber.
 * normal: everything else, including any completed task.
 */
export function dueUrgency(task: Task): DueUrgency {
  if (task.status === "done") return "normal";
  const days = daysUntil(task.dueDate);
  if (days < 0) return "overdue";
  if (days <= 2) return "soon";
  return "normal";
}

/** Two or more due-date revisions on one task is worth a second look. */
export function isSuspiciousRevision(task: Task) {
  return task.revisions.length >= 2;
}

/** Tally a task's sticker reactions by stickerId, e.g. { angry: 2, fire: 1 }. */
export function reactionCounts(task: Task): Record<string, number> {
  return task.reactions.reduce<Record<string, number>>((acc, r) => {
    acc[r.stickerId] = (acc[r.stickerId] ?? 0) + 1;
    return acc;
  }, {});
}

/**
 * Default reading order for a list of task cards: finished work sinks to the
 * bottom (it's no longer actionable, so it shouldn't compete for attention
 * with what's still open), and everything still open reads most-urgent
 * first — earliest due date leads, which naturally puts overdue tasks (due
 * date already in the past) ahead of everything else. Doesn't mutate the
 * input array.
 */
export function sortTasksForDisplay(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const aDone = a.status === "done" ? 1 : 0;
    const bDone = b.status === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });
}
