import { create } from "zustand";
import { tasks as initialTasks, departmentIdsOf, departments, getUser } from "@/modules/report_task/data/mock";
import { daysUntil, formatShortDate } from "@/modules/report_task/lib/format";
import { statusMeta } from "@/modules/report_task/lib/task-meta";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useActivityLogStore } from "@/modules/report_task/store/activity-log-store";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";
import type { Attachment, Task, TaskPriority, TaskStatus } from "@/modules/report_task/types";

/**
 * Single choke point for the audit trail — every meaningful task action logs
 * through here instead of at each UI call site, so nothing gets forgotten.
 * Deliberately NOT wired into `updateTask` (fires per keystroke on
 * title/description edits — would flood the log) or checklist/attachment/
 * comment actions, which are lower-stakes than status/date/penalty/sticker
 * changes.
 */
function logActivity(userId: string, action: string, target: string, taskId: string, detail?: string) {
  useActivityLogStore.getState().log({ userId, action, target, taskId, detail });
}

/**
 * A task marked "done" while it's already near/at/past its due date is worth
 * a lead double-checking right away, not discovering weeks later — nudge
 * whoever heads a department the task touches, plus whoever assigned it.
 * Lives here (not at each UI call site) so every path that can complete a
 * task — drag, dropdown, checkbox, checklist auto-complete, bulk actions —
 * triggers it the same way, with nothing to forget wiring up per call site.
 */
function notifyLateCompletion(task: Task) {
  const days = daysUntil(task.dueDate);
  if (days > 2) return;
  const actorId = useIdentityStore.getState().viewingAsUserId;
  const actorName = getUser(actorId)?.name ?? "มีคน";
  const heads = departments.filter((d) => task.departmentIds.includes(d.id)).map((d) => d.headId);
  const recipients = Array.from(new Set([...heads, task.assignedById]));
  const label =
    days < 0 ? `เลยกำหนดส่งไปแล้ว ${Math.abs(days)} วัน` : days === 0 ? "ถึงกำหนดส่งวันนี้พอดี" : `ใกล้ถึงกำหนดส่ง (เหลือ ${days} วัน)`;
  useNotificationStore
    .getState()
    .notifyMany(recipients, actorId, `${actorName} ทำเครื่องหมาย "${task.title}" ว่าเสร็จสิ้น — ${label} ลองตรวจงานให้แน่ใจว่าเรียบร้อยจริง`);
}

/**
 * A points change is worth telling people about directly, not just leaving in
 * the activity log for someone to stumble on — the assignee(s) whose score it
 * hits, plus whoever heads a department the task touches (so a head still
 * knows when someone else — the task's own assigner — docks/undocks a point
 * in their team without going through them). notifyMany already skips
 * self-notifying, so the actor themselves is excluded automatically whether
 * that's a head or an assignee.
 */
function notifyPenaltyChange(task: Task, byUserId: string, message: string) {
  const heads = departments.filter((d) => task.departmentIds.includes(d.id)).map((d) => d.headId);
  const recipients = Array.from(new Set([...task.assigneeIds, ...heads]));
  useNotificationStore.getState().notifyMany(recipients, byUserId, message);
}

// Re-exported for callers that only need the constant, not the sweep logic
// itself (which now runs server-side — see /api/report-task/tasks/sweep).
export { SYSTEM_USER_ID, LATE_PENALTY_POINTS } from "@/modules/report_task/lib/task-penalty-sweep";

export type PenaltyFilter = "all" | "overdue" | "pending" | "docked";

interface TaskFilters {
  search: string;
  assigneeId: string | "all";
  departmentId: string | "all";
  priority: TaskPriority | "all";
  /** Filter by missed-deadline docking status. */
  penalty: PenaltyFilter;
}

interface TaskStore {
  tasks: Task[];
  /** True once TaskSync has loaded the file-backed data (used for loading states). */
  loaded: boolean;
  filters: TaskFilters;
  selectedTaskId: string | null;
  setFilters: (f: Partial<TaskFilters>) => void;
  resetFilters: () => void;
  moveTask: (taskId: string, status: TaskStatus) => void;
  reviseDueDate: (taskId: string, newDate: string, reason: string, revisedBy: string) => void;
  /**
   * A deliberate "this was marked done but wasn't actually finished"
   * correction — distinct from a normal status change: pulls it out of
   * "เสร็จสิ้น" with a fresh start/due date and a required reason, while the
   * original due date and every prior revision stay intact, and any
   * sticker/penalty already on the task is left untouched.
   */
  reopenTask: (taskId: string, newStartDate: string, newDueDate: string, reason: string, revisedBy: string) => void;
  /**
   * Per-assignee "my part is done" toggle for a task shared by 2+ people —
   * the task's own status only flips to "done" once every assignee has
   * marked themselves done here, and flips back to "in_progress" if anyone
   * unmarks after the group had completed. A no-op if `userId` isn't
   * actually one of this task's assignees. Single-assignee tasks still use
   * `moveTask` directly — this only matters once there's more than one
   * person whose own completion needs tracking separately.
   */
  toggleMyCompletion: (taskId: string, userId: string) => void;
  selectTask: (id: string | null) => void;
  addTask: (task: Task) => void;
  removeTask: (taskId: string) => void;
  /** Deletes every task created together in one "ทำซ้ำ" (repeat) batch. */
  removeTaskSeries: (seriesId: string) => void;
  updateTask: (taskId: string, patch: Partial<Task>) => void;
  setAssignees: (taskId: string, assigneeIds: string[]) => void;
  addComment: (taskId: string, message: string, authorId: string) => void;
  removeComment: (taskId: string, commentId: string) => void;
  addAttachment: (taskId: string, attachment: Attachment) => void;
  removeAttachment: (taskId: string, attachmentId: string) => void;
  addChecklistItem: (taskId: string, text: string) => void;
  toggleChecklistItem: (taskId: string, itemId: string) => void;
  removeChecklistItem: (taskId: string, itemId: string) => void;
  addReaction: (taskId: string, stickerId: string, byUserId: string, note?: string) => void;
  removeReaction: (taskId: string, reactionId: string) => void;
  /** Case-by-case missed-deadline dock, applied at a lead's discretion. */
  applyPenalty: (taskId: string, points: number, byUserId: string, reason?: string) => void;
  clearPenalty: (taskId: string) => void;
  /**
   * Cancels an automatic strict-deadline dock — owner-only, and only with a
   * stated reason, logged as a comment so it leaves a trail instead of
   * quietly disappearing the way a normal undock would.
   */
  overrideAutoPenalty: (taskId: string, byUserId: string, reason: string) => void;
}

const defaultFilters: TaskFilters = { search: "", assigneeId: "all", departmentId: "all", priority: "all", penalty: "all" };

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: initialTasks,
  loaded: false,
  filters: defaultFilters,
  selectedTaskId: null,
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  resetFilters: () => set({ filters: defaultFilters }),
  moveTask: (taskId, status) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId || t.status === status) return t;
        if (status === "done") notifyLateCompletion(t);
        logActivity(
          useIdentityStore.getState().viewingAsUserId,
          "เปลี่ยนสถานะ",
          t.title,
          t.id,
          `${statusMeta[t.status].label} → ${statusMeta[status].label}`
        );
        return {
          ...t,
          status,
          // Leaving "done" for anything else is worth remembering even after
          // it's redone properly — the flag never clears itself.
          reopenedOnce: t.status === "done" ? true : t.reopenedOnce,
          // Stamp when it actually closed (cleared if it leaves "done" again)
          // so a later sweep can judge lateness by completion time, not "today".
          completedAt: status === "done" ? new Date().toISOString() : undefined,
          updatedAt: new Date().toISOString(),
        };
      }),
    })),
  reviseDueDate: (taskId, newDate, reason, revisedBy) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const revisionNumber = t.revisions.length + 1;
        logActivity(revisedBy, "แก้ไขกำหนดส่ง", t.title, t.id, `${formatShortDate(t.dueDate)} → ${formatShortDate(newDate)} · ${reason}`);
        return {
          ...t,
          dueDate: newDate,
          revisions: [
            ...t.revisions,
            {
              revisionNumber,
              previousDate: t.dueDate,
              newDate,
              reason,
              revisedBy,
              revisedAt: new Date().toISOString(),
            },
          ],
          updatedAt: new Date().toISOString(),
        };
      }),
    })),
  reopenTask: (taskId, newStartDate, newDueDate, reason, revisedBy) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const revisionNumber = t.revisions.length + 1;
        logActivity(revisedBy, "เปิดงานใหม่", t.title, t.id, reason);
        return {
          ...t,
          status: "todo",
          // Bumped to critical so it doesn't quietly sit at whatever priority
          // it had before — a reopened task needs eyes on it right away.
          priority: "critical",
          startDate: newStartDate,
          dueDate: newDueDate,
          reopenedOnce: true,
          completedAt: undefined,
          // Whoever falsely marked their own part done needs to re-mark it
          // for real this cycle — otherwise the task would silently
          // re-complete itself the instant the last other assignee finishes.
          completedAssigneeIds: [],
          // A dock from the PREVIOUS deadline miss shouldn't block docking a
          // fresh one if this reopened cycle blows its new deadline too —
          // the old dock is already permanent history in the activity log,
          // so clearing it here just frees the chip up for the next verdict.
          penalty: null,
          revisions: [
            ...t.revisions,
            {
              revisionNumber,
              previousDate: t.dueDate,
              newDate: newDueDate,
              reason: `[เปิดงานใหม่] ${reason}`,
              revisedBy,
              revisedAt: new Date().toISOString(),
            },
          ],
          updatedAt: new Date().toISOString(),
        };
      }),
    })),
  toggleMyCompletion: (taskId, userId) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId || !t.assigneeIds.includes(userId)) return t;
        const wasCompleted = (t.completedAssigneeIds ?? []).includes(userId);
        const nextCompleted = wasCompleted
          ? (t.completedAssigneeIds ?? []).filter((id) => id !== userId)
          : [...(t.completedAssigneeIds ?? []), userId];
        const allDone = t.assigneeIds.every((id) => nextCompleted.includes(id));

        if (allDone && t.status !== "done") {
          logActivity(userId, "เสร็จสิ้น (ครบทุกคน)", t.title, t.id, `${t.assigneeIds.length}/${t.assigneeIds.length} คน`);
          notifyLateCompletion(t);
          return { ...t, completedAssigneeIds: nextCompleted, status: "done", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        }
        if (!allDone && t.status === "done") {
          const name = getUser(userId)?.name ?? "มีคน";
          logActivity(userId, "เปิดงานกลับ (ยกเลิกเสร็จส่วนตัว)", t.title, t.id, `${name} ยังไม่เสร็จ`);
          return { ...t, completedAssigneeIds: nextCompleted, status: "in_progress", completedAt: undefined, updatedAt: new Date().toISOString() };
        }
        logActivity(
          userId,
          wasCompleted ? "ยกเลิกเครื่องหมายเสร็จ (ส่วนตัว)" : "ทำเครื่องหมายเสร็จ (ส่วนตัว)",
          t.title,
          t.id,
          `${nextCompleted.length}/${t.assigneeIds.length} คน`
        );
        return { ...t, completedAssigneeIds: nextCompleted, updatedAt: new Date().toISOString() };
      }),
    })),
  selectTask: (id) => set({ selectedTaskId: id }),
  addTask: (task) => {
    const assigneeNames = task.assigneeIds.map((id) => getUser(id)?.name).filter(Boolean).join(", ");
    logActivity(task.assignedById, "สร้างงาน", task.title, task.id, assigneeNames ? `มอบให้ ${assigneeNames}` : "ยังไม่มีผู้รับผิดชอบ");
    set((s) => ({ tasks: [task, ...s.tasks] }));
  },
  removeTask: (taskId) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (t) logActivity(useIdentityStore.getState().viewingAsUserId, "ลบงาน", t.title, t.id);
      return { tasks: s.tasks.filter((x) => x.id !== taskId) };
    }),
  removeTaskSeries: (seriesId) =>
    set((s) => {
      const matching = s.tasks.filter((x) => x.seriesId === seriesId);
      if (matching.length > 0) {
        const actorId = useIdentityStore.getState().viewingAsUserId;
        logActivity(actorId, "ลบทั้งชุด", matching[0]!.title, matching[0]!.id, `${matching.length} รายการ`);
      }
      return { tasks: s.tasks.filter((x) => x.seriesId !== seriesId) };
    }),
  updateTask: (taskId, patch) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t
      ),
    })),
  // Assignees drive a task's departments, so recompute them together.
  setAssignees: (taskId, assigneeIds) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (t && JSON.stringify([...t.assigneeIds].sort()) !== JSON.stringify([...assigneeIds].sort())) {
        const actorId = useIdentityStore.getState().viewingAsUserId;
        const names = assigneeIds.map((id) => getUser(id)?.name).filter(Boolean).join(", ");
        logActivity(actorId, "เปลี่ยนผู้รับผิดชอบ", t.title, t.id, names ? `เป็น ${names}` : "ไม่มีผู้รับผิดชอบ");
      }
      return {
        tasks: s.tasks.map((x) =>
          x.id === taskId
            ? { ...x, assigneeIds, departmentIds: departmentIdsOf(assigneeIds), updatedAt: new Date().toISOString() }
            : x
        ),
      };
    }),
  addComment: (taskId, message, authorId) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id !== taskId
          ? t
          : {
              ...t,
              comments: [
                ...t.comments,
                { id: `${taskId}-cmt-${crypto.randomUUID()}`, authorId, message, createdAt: new Date().toISOString() },
              ],
            }
      ),
    })),
  removeComment: (taskId, commentId) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id !== taskId ? t : { ...t, comments: t.comments.filter((c) => c.id !== commentId) }
      ),
    })),
  addAttachment: (taskId, attachment) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id !== taskId ? t : { ...t, attachments: [...t.attachments, attachment] }
      ),
    })),
  removeAttachment: (taskId, attachmentId) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id !== taskId ? t : { ...t, attachments: t.attachments.filter((a) => a.id !== attachmentId) }
      ),
    })),
  addChecklistItem: (taskId, text) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id !== taskId
          ? t
          : {
              ...t,
              checklist: [
                ...t.checklist,
                { id: `${taskId}-chk-${new Date().toISOString().replace(/\D/g, "")}`, text, done: false },
              ],
              updatedAt: new Date().toISOString(),
            }
      ),
    })),
  toggleChecklistItem: (taskId, itemId) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id !== taskId
          ? t
          : {
              ...t,
              checklist: t.checklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c)),
              updatedAt: new Date().toISOString(),
            }
      ),
    })),
  removeChecklistItem: (taskId, itemId) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id !== taskId ? t : { ...t, checklist: t.checklist.filter((c) => c.id !== itemId) }
      ),
    })),
  addReaction: (taskId, stickerId, byUserId, note) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (t) {
        const label = useStickerStore.getState().stickers.find((st) => st.id === stickerId)?.label ?? stickerId;
        logActivity(byUserId, "ติดสติกเกอร์", t.title, t.id, label);
      }
      return {
        tasks: s.tasks.map((x) =>
          x.id !== taskId
            ? x
            : {
                ...x,
                reactions: [
                  ...x.reactions,
                  { id: `${taskId}-rxn-${crypto.randomUUID()}`, stickerId, byUserId, note, createdAt: new Date().toISOString() },
                ],
              }
        ),
      };
    }),
  removeReaction: (taskId, reactionId) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (t) logActivity(useIdentityStore.getState().viewingAsUserId, "ลบสติกเกอร์", t.title, t.id);
      return {
        tasks: s.tasks.map((x) =>
          x.id !== taskId ? x : { ...x, reactions: x.reactions.filter((r) => r.id !== reactionId) }
        ),
      };
    }),
  applyPenalty: (taskId, points, byUserId, reason) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (t) {
        logActivity(byUserId, "หักคะแนน", t.title, t.id, `−${points} คะแนน${reason ? ` · ${reason}` : ""}`);
        const actorName = getUser(byUserId)?.name ?? "มีคน";
        notifyPenaltyChange(t, byUserId, `${actorName} หักคะแนน "${t.title}" −${points} คะแนน${reason ? ` (${reason})` : ""}`);
      }
      return {
        tasks: s.tasks.map((x) =>
          x.id !== taskId
            ? x
            : {
                ...x,
                penalty: { points, byUserId, reason, appliedAt: new Date().toISOString() },
                updatedAt: new Date().toISOString(),
              }
        ),
      };
    }),
  clearPenalty: (taskId) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (t) {
        const actorId = useIdentityStore.getState().viewingAsUserId;
        logActivity(actorId, "ยกเลิกการหักคะแนน", t.title, t.id);
        const actorName = getUser(actorId)?.name ?? "มีคน";
        notifyPenaltyChange(t, actorId, `${actorName} ยกเลิกการหักคะแนน "${t.title}"`);
      }
      return {
        tasks: s.tasks.map((x) => (x.id !== taskId ? x : { ...x, penalty: null, updatedAt: new Date().toISOString() })),
      };
    }),
  overrideAutoPenalty: (taskId, byUserId, reason) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (t) {
        logActivity(byUserId, "ยกเลิกการหักคะแนนอัตโนมัติ", t.title, t.id, reason);
        const actorName = getUser(byUserId)?.name ?? "มีคน";
        notifyPenaltyChange(t, byUserId, `${actorName} ยกเลิกการหักคะแนนอัตโนมัติของ "${t.title}" — เหตุผล: ${reason}`);
      }
      return {
        tasks: s.tasks.map((x) =>
          x.id !== taskId
            ? x
            : {
                ...x,
                penalty: null,
                comments: [
                  ...x.comments,
                  {
                    id: `${taskId}-cmt-${crypto.randomUUID()}`,
                    authorId: byUserId,
                    message: `[ยกเลิกการหักคะแนนอัตโนมัติ] ${reason}`,
                    createdAt: new Date().toISOString(),
                  },
                ],
                updatedAt: new Date().toISOString(),
              }
        ),
      };
    }),
}));
