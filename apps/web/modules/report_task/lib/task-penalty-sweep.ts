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
  /** refIds (same shape the sweep route records into core.performance_events
   * — `taskId`, or `taskId:userId` for a group task) of automatic docks this
   * sweep took back, so the caller can drop the matching score events. */
  revokedRefIds: string[];
}

/** Calendar day of `iso` as a UTC-midnight timestamp — due dates are stored
 * as a UTC calendar day (see daysUntil in format.ts), a revision's revisedAt
 * is a real moment read in local time. */
function dueDay(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function localDay(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * เสร็จทันกำหนดไหม — เทียบระดับ "วัน" (เสร็จวันไหนก็ได้ของวันครบกำหนด) และถ้างาน
 * ตั้งเวลาส่ง (dueTime "HH:mm") ไว้ วันครบกำหนดต้องเสร็จไม่เกินเวลานั้น
 * เดิมเทียบ timestamp ตรง ๆ กับวันครบกำหนด (เที่ยงคืน) ⇒ เสร็จ "ในวัน" ครบกำหนดก็นับว่าเลย
 */
function finishedOnTime(finishedAt: string, due: string, dueTime?: string): boolean {
  const finDay = localDay(finishedAt);
  const due0 = dueDay(due);
  if (finDay < due0) return true;
  if (finDay > due0) return false;
  if (!dueTime || !/^\d{1,2}:\d{2}$/.test(dueTime)) return true;
  const [h, m] = dueTime.split(":").map(Number) as [number, number];
  const f = new Date(finishedAt);
  return f.getHours() * 60 + f.getMinutes() <= h * 60 + m;
}

/**
 * The due date a task is actually held to for the late-penalty check.
 *
 * Pushing the date out *before* it passed is a legitimate extension — the
 * assignee is now accountable to the new date (e.g. due 25/09, extended on
 * 25/09 to 02/10 → not late until after 02/10). Pushing it out *after* it
 * already passed doesn't erase the miss: the chain stops at the first
 * revision made too late, and that deadline is the one judged.
 *
 * Previously this was always `originalDueDate`, so any extension — even one
 * agreed before the deadline — still got docked the day after the old date.
 */
export function penaltyDueDate(task: Pick<Task, "originalDueDate" | "revisions">): string {
  const revisions = [...(task.revisions ?? [])].sort((a, b) => a.revisedAt.localeCompare(b.revisedAt));
  const start = revisions[0]?.previousDate ?? task.originalDueDate;
  let due = start;
  for (const r of revisions) {
    if (localDay(r.revisedAt) > dueDay(due)) break;
    due = r.newDate;
  }
  // rejectReview moves originalDueDate forward itself when the assignee had
  // met their deadline (see task-store.ts) — honour that reset too.
  if (task.originalDueDate !== start && dueDay(task.originalDueDate) > dueDay(due)) {
    due = task.originalDueDate;
  }
  return due;
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
  const revokedRefIds: string[] = [];

  /** Undo an automatic dock on an individual task that turned out not late. */
  function revoke(t: Task): Task {
    changed = true;
    revokedRefIds.push(t.id);
    logs.push({
      userId: SYSTEM_USER_ID,
      action: "คืนคะแนนอัตโนมัติ",
      target: t.title,
      taskId: t.id,
      detail: "เลื่อนกำหนดส่งก่อนครบกำหนด ไม่ถือว่าเลยกำหนด",
    });
    return { ...t, penalty: null, missedDeadlineOnce: false };
  }

  const next = tasks.map((t) => {
    // A finished task never re-enters the "still active and overdue" branch
    // below, so without this it could dodge ever being flagged just by being
    // marked done before a sweep caught it as overdue — judge it by when it
    // actually closed (completedAt, falling back to updatedAt for older
    // data) against the ORIGINAL due date instead.
    const heldTo = penaltyDueDate(t);

    if (t.status === "done") {
      const finishedAt = t.completedAt ?? t.updatedAt;
      // งานกลุ่มเลื่อนกำหนดได้รายคน (assigneeDueDates — "แก้ไขทั้งหมด"/รายคน) เดิมที่นี่
      // ดูแค่กำหนดของทั้งงาน ⇒ เลื่อนให้ทุกคนแล้วส่งทันกำหนดใหม่ ก็ยังโดนตีตรา
      // "เลยกำหนด" ถาวร (เจอจริง: T-2569-0028 เลื่อน 25/09 → 02/10 เสร็จ 25/09)
      // ใช้กำหนดที่ช้าที่สุดของทุกคน — งานปิดเมื่อทุกคนเสร็จ จึงเทียบกับคนสุดท้าย
      const deadline =
        t.taskMode === "group"
          ? t.assigneeIds
              .map((id) => t.assigneeDueDates?.[id] ?? heldTo)
              .reduce((a, b) => (dueDay(b) > dueDay(a) ? b : a), heldTo)
          : heldTo;
      const onTime = finishedOnTime(finishedAt, deadline, t.dueTime);
      if (onTime && t.taskMode !== "group" && t.penalty?.byUserId === SYSTEM_USER_ID) {
        return revoke(t);
      }
      if (onTime) {
        // ตีตราผิดไว้แล้วจากกฎเดิม — เอาออก เฉพาะเมื่อไม่มีการหักคะแนนค้างอยู่
        const docked = !!t.penalty || Object.keys(t.penalties ?? {}).length > 0;
        if (t.missedDeadlineOnce && !docked) {
          changed = true;
          return { ...t, missedDeadlineOnce: false };
        }
        return t;
      }
      if (t.missedDeadlineOnce) return t;
      changed = true;
      return { ...t, missedDeadlineOnce: true };
    }

    if (t.taskMode === "group") {
      let updated = t;
      const heads = departments.filter((d) => t.departmentIds.includes(d.id)).map((d) => d.headId);
      for (const assigneeId of t.assigneeIds) {
        // Each assignee is judged against THEIR OWN effective due date — a
        // shared default, unless this person has an override — not just
        // whether the task as a whole is late.
        const override = updated.assigneeDueDates?.[assigneeId];
        const effectiveDueDate = override ?? heldTo;
        const existing = updated.penalties?.[assigneeId];
        // An automatic dock on the shared date that an in-time extension has
        // since made wrong — take it back (an override is left alone: it can
        // be set after the fact, so it isn't proof the miss didn't happen).
        if (existing && !override && existing.byUserId === SYSTEM_USER_ID && daysUntil(effectiveDueDate) >= 0) {
          const { [assigneeId]: _dropped, ...rest } = updated.penalties ?? {};
          updated = { ...updated, penalties: rest };
          revokedRefIds.push(`${t.id}:${assigneeId}`);
          logs.push({
            userId: SYSTEM_USER_ID,
            action: "คืนคะแนนอัตโนมัติ",
            target: t.title,
            taskId: t.id,
            detail: `${getUser(assigneeId)?.name ?? "คนหนึ่ง"} · เลื่อนกำหนดส่งก่อนครบกำหนด ไม่ถือว่าเลยกำหนด`,
          });
          changed = true;
          continue;
        }
        if ((updated.completedAssigneeIds ?? []).includes(assigneeId)) continue;
        if (existing) continue;
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

    // Measured against penaltyDueDate — an extension only counts if it was
    // made before the deadline it replaced had passed, so pushing a date out
    // after the fact doesn't quietly erase a miss.
    const overdue = daysUntil(heldTo) < 0;
    if (!overdue) {
      return t.penalty?.byUserId === SYSTEM_USER_ID ? revoke(t) : t;
    }

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

  return { tasks: next, changed, logs, notifications, revokedRefIds };
}
