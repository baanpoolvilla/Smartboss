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

/**
 * How many times this task was specifically "reopened" (marked done too
 * early, then pulled back out) — a subset of `revisions`, tagged at write
 * time in `reopenTask`. Derived instead of a separate counter field so it
 * can never drift from the actual revision history.
 */
export function reopenCount(task: Task) {
  return task.revisions.filter((r) => r.reason.startsWith("[เปิดงานใหม่]")).length;
}

/** Tally a task's sticker reactions by stickerId, e.g. { angry: 2, fire: 1 }. */
export function reactionCounts(task: Task): Record<string, number> {
  return task.reactions.reduce<Record<string, number>>((acc, r) => {
    acc[r.stickerId] = (acc[r.stickerId] ?? 0) + 1;
    return acc;
  }, {});
}
