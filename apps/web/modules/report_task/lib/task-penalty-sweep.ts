import { departments, getUser } from "@/modules/report_task/lib/directory";
import { daysUntil } from "@/modules/report_task/lib/format";
import type { Task } from "@/modules/report_task/types";

/** Default dock for a task that blew its deadline. */
export const LATE_PENALTY_POINTS = 3;

/** byUserId used on a penalty applied automatically rather than by a lead's click. */
export const SYSTEM_USER_ID = "system";

export interface PenaltySweepLogEntry {
  userId: string;
  action: string;
  target: string;
  taskId: string;
  detail?: string;
}

export interface PenaltySweepNotification {
  recipients: string[];
  byUserId: string;
  message: string;
}

export interface PenaltySweepResult {
  tasks: Task[];
  changed: boolean;
  logs: PenaltySweepLogEntry[];
  notifications: PenaltySweepNotification[];
}

/**
 * Sweep every task: flag `missedDeadlineOnce` the moment it's first overdue
 * (kept forever as history), and dock `latePenaltyPoints` immediately — every
 * task is strict, so no lead has to click anything. Safe to call repeatedly;
 * a no-op once everything is already flagged/docked.
 *
 * Pure — returns what changed instead of writing anywhere, so the caller (the
 * server route at /api/tasks/sweep) owns persistence and can do it under the
 * same optimistic-concurrency guard as any other task write. This used to run
 * independently in every open browser tab (H3 in the production-readiness
 * audit) — racing writes could flap/duplicate a dock. Now there's exactly one
 * place this logic runs.
 *
 * `latePenaltyPoints` defaults to LATE_PENALTY_POINTS but should be passed by
 * the caller from the org's own setting (readStore(orgId, "penalty-settings"),
 * the same number /report-task/settings lets a lead edit). Previously this
 * function always used the hardcoded constant regardless of what an org had
 * configured — every automatic dock landed as −3 even when a company had set
 * a different default, and that number is also what flows into the central
 * score (core.performance_events, category task_late) via the sweep route.
 */
export function sweepAutoPenalties(
  tasks: Task[],
  latePenaltyPoints: number = LATE_PENALTY_POINTS,
): PenaltySweepResult {
  let changed = false;
  const logs: PenaltySweepLogEntry[] = [];
  const notifications: PenaltySweepNotification[] = [];

  const next = tasks.map((t) => {
    // A finished task never re-enters the "still active and overdue" branch
    // below, so without this it could dodge ever being flagged just by being
    // marked done before a sweep caught it as overdue — judge it by when it
    // actually closed (completedAt, falling back to updatedAt for older
    // data) against the ORIGINAL due date instead.
    if (t.status === "done") {
      if (t.missedDeadlineOnce) return t;
      const finishedAt = t.completedAt ?? t.updatedAt;
      if (new Date(finishedAt).getTime() <= new Date(t.originalDueDate).getTime()) return t;
      changed = true;
      return { ...t, missedDeadlineOnce: true };
    }

    if (t.taskMode === "group") {
      let updated = t;
      const heads = departments.filter((d) => t.departmentIds.includes(d.id)).map((d) => d.headId);
      for (const assigneeId of t.assigneeIds) {
        if ((updated.completedAssigneeIds ?? []).includes(assigneeId)) continue;
        if (updated.penalties?.[assigneeId]) continue;
        // Each assignee is judged against THEIR OWN effective due date — a
        // shared default, unless this person has an override — not just
        // whether the task as a whole is late.
        const effectiveDueDate = updated.assigneeDueDates?.[assigneeId] ?? updated.originalDueDate;
        if (daysUntil(effectiveDueDate) >= 0) continue;

        if (!updated.missedDeadlineOnce) updated = { ...updated, missedDeadlineOnce: true };
        const penaltyEntry = {
          points: latePenaltyPoints,
          byUserId: SYSTEM_USER_ID,
          appliedAt: new Date().toISOString(),
          reason: "เลยกำหนดส่ง — หักคะแนนอัตโนมัติ",
        };
        updated = { ...updated, penalties: { ...updated.penalties, [assigneeId]: penaltyEntry } };
        const name = getUser(assigneeId)?.name ?? "คนหนึ่ง";
        logs.push({
          userId: SYSTEM_USER_ID,
          action: "หักคะแนนอัตโนมัติ",
          target: t.title,
          taskId: t.id,
          detail: `${name} −${latePenaltyPoints} คะแนน · เลยกำหนดส่ง`,
        });
        notifications.push({
          recipients: Array.from(new Set([assigneeId, ...heads])),
          byUserId: SYSTEM_USER_ID,
          message: `ระบบหักคะแนนอัตโนมัติ "${t.title}" (ส่วนของคุณ) −${latePenaltyPoints} คะแนน (เลยกำหนดส่ง)`,
        });
        changed = true;
      }
      return updated;
    }

    // Measured against the ORIGINAL due date, not the current (possibly
    // revised) one — pushing a due date out shouldn't quietly erase the fact
    // the original commitment was already blown.
    const overdue = daysUntil(t.originalDueDate) < 0;
    if (!overdue) return t;

    let updated = t;
    if (!updated.missedDeadlineOnce) {
      updated = { ...updated, missedDeadlineOnce: true };
      changed = true;
    }
    if (!updated.penalty) {
      updated = {
        ...updated,
        penalty: {
          points: latePenaltyPoints,
          byUserId: SYSTEM_USER_ID,
          appliedAt: new Date().toISOString(),
          reason: "เลยกำหนดส่ง — หักคะแนนอัตโนมัติ",
        },
      };
      logs.push({
        userId: SYSTEM_USER_ID,
        action: "หักคะแนนอัตโนมัติ",
        target: t.title,
        taskId: t.id,
        detail: `−${latePenaltyPoints} คะแนน · เลยกำหนดส่ง`,
      });
      const heads = departments.filter((d) => t.departmentIds.includes(d.id)).map((d) => d.headId);
      const recipients = Array.from(new Set([...t.assigneeIds, ...heads]));
      notifications.push({
        recipients,
        byUserId: SYSTEM_USER_ID,
        message: `ระบบหักคะแนนอัตโนมัติ "${t.title}" −${latePenaltyPoints} คะแนน (เลยกำหนดส่ง)`,
      });
      changed = true;
    }
    return updated;
  });

  return { tasks: next, changed, logs, notifications };
}
