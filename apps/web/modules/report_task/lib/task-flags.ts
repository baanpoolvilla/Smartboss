import type { Task } from "@/modules/report_task/types";
import { daysUntil } from "@/modules/report_task/lib/format";
import { taskPriorityOrder } from "@/modules/report_task/lib/task-meta";

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
 * Default reading order for a list of task cards, three tiers: finished work
 * sinks to the very bottom (it's no longer actionable, so it shouldn't
 * compete for attention with what's still open); overdue-and-not-done comes
 * first (the most urgent group, called out as its own tier rather than just
 * "earliest due date" so it reads as a clear block); everything else follows.
 * Within the "done" tier, cards still waiting on sign-off ("รอเช็ค" — see
 * task-detail-sheet.tsx's markReviewed) lead the un-reviewed ones sink below
 * once someone hits "ผ่าน" — otherwise clicking "ผ่าน" only swaps a badge for
 * nothing and the card stays wherever createdAt happened to place it, which
 * reads as the sign-off feature not doing anything. Within any other tier,
 * highest priority (ด่วนมาก first) leads, then soonest due date, so the
 * card that most needs attention next sits at the top instead of just
 * whichever was created first — createdAt only breaks a remaining tie (same
 * priority, same due date) for stable ordering. Doesn't mutate the input
 * array.
 */
export function sortTasksForDisplay(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const aDone = a.status === "done" ? 1 : 0;
    const bDone = b.status === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const aOverdue = a.status !== "done" && dueUrgency(a) === "overdue" ? 0 : 1;
    const bOverdue = b.status !== "done" && dueUrgency(b) === "overdue" ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    if (aDone === 1) {
      const aReviewed = a.reviewedBy ? 1 : 0;
      const bReviewed = b.reviewedBy ? 1 : 0;
      if (aReviewed !== bReviewed) return aReviewed - bReviewed;
    }
    const aPriority = taskPriorityOrder.indexOf(a.priority);
    const bPriority = taskPriorityOrder.indexOf(b.priority);
    if (aPriority !== bPriority) return aPriority - bPriority;
    const aDue = new Date(a.dueDate).getTime();
    const bDue = new Date(b.dueDate).getTime();
    if (aDue !== bDue) return aDue - bDue;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}
