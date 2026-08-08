import { departments } from "@/modules/report_task/data/mock";
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
 * (kept forever as history), and for "strict" tasks dock the default points
 * immediately — no lead has to click anything. Safe to call repeatedly; a
 * no-op once everything is already flagged/docked.
 *
 * Pure — returns what changed instead of writing anywhere, so the caller (the
 * server route at /api/report-task/tasks/sweep) owns persistence and can do it under the
 * same optimistic-concurrency guard as any other task write. This used to run
 * independently in every open browser tab (H3 in the production-readiness
 * audit) — racing writes could flap/duplicate a dock. Now there's exactly one
 * place this logic runs.
 */
export function sweepAutoPenalties(tasks: Task[]): PenaltySweepResult {
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
    if ((updated.deadlineType ?? "flexible") === "strict" && !updated.penalty) {
      updated = {
        ...updated,
        penalty: {
          points: LATE_PENALTY_POINTS,
          byUserId: SYSTEM_USER_ID,
          appliedAt: new Date().toISOString(),
          reason: "เลยกำหนดส่ง (ตรงกำหนด) — หักคะแนนอัตโนมัติ",
        },
      };
      logs.push({
        userId: SYSTEM_USER_ID,
        action: "หักคะแนนอัตโนมัติ",
        target: t.title,
        taskId: t.id,
        detail: `−${LATE_PENALTY_POINTS} คะแนน · เลยกำหนดส่ง (ตรงกำหนด)`,
      });
      const heads = departments.filter((d) => t.departmentIds.includes(d.id)).map((d) => d.headId);
      const recipients = Array.from(new Set([...t.assigneeIds, ...heads]));
      notifications.push({
        recipients,
        byUserId: SYSTEM_USER_ID,
        message: `ระบบหักคะแนนอัตโนมัติ "${t.title}" −${LATE_PENALTY_POINTS} คะแนน (เลยกำหนดส่งตรงเวลา)`,
      });
      changed = true;
    }
    return updated;
  });

  return { tasks: next, changed, logs, notifications };
}
