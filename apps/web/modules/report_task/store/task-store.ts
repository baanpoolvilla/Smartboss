import { create } from "zustand";
import { departmentIdsOf, departments, getUser, users } from "@/modules/report_task/lib/directory";
import { daysUntil, formatShortDate } from "@/modules/report_task/lib/format";
import { statusMeta, priorityMeta } from "@/modules/report_task/lib/task-meta";
import type { DatePreset } from "@/modules/report_task/lib/date-filter";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useActivityLogStore } from "@/modules/report_task/store/activity-log-store";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";
import { deriveCompletedAssigneeIds, isTaskFullyDone } from "@/modules/report_task/lib/task-completion";
import type { Attachment, ChecklistItem, Task, TaskPriority, TaskStatus } from "@/modules/report_task/types";

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

function priorityLabel(p: TaskPriority): string {
  return priorityMeta[p]?.label ?? p;
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
  // CEO/company owner sees this too, not just the assigner/dept head — a
  // near-deadline or late completion is exactly the kind of thing worth a
  // second set of eyes on, and the owner can already reopen anything via
  // reviseDueDate if it turns out not actually done (see its own doc).
  const owners = users.filter((u) => u.isOwner).map((u) => u.id);
  const recipients = Array.from(new Set([...heads, task.assignedById, ...owners]));
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

/**
 * Recomputes per-assignee completion from a task's checklist and applies the
 * same status transition `toggleMyCompletion` used to own directly — an
 * assignee's part is done once every item they own is checked, and the
 * task's own status only flips to "done" once every assignee is. Single
 * choke point so `toggleChecklistItem`/`addChecklistItem`/
 * `removeChecklistItem`/`toggleAssigneeChecklist` all transition identically
 * instead of four slightly-different copies of this logic.
 */
function applyChecklistDerivedCompletion(t: Task, nextChecklist: ChecklistItem[], actorUserId: string): Task {
  const nextCompleted = deriveCompletedAssigneeIds(t.assigneeIds, nextChecklist);
  const prevCompleted = t.completedAssigneeIds ?? [];
  const allDone = t.assigneeIds.length > 0 && t.assigneeIds.every((id) => nextCompleted.includes(id));
  const now = new Date().toISOString();

  if (allDone && t.status !== "done") {
    logActivity(actorUserId, "เสร็จสิ้น (ครบทุกคน)", t.title, t.id, `${t.assigneeIds.length}/${t.assigneeIds.length} คน`);
    const updated: Task = {
      ...t,
      checklist: nextChecklist,
      completedAssigneeIds: nextCompleted,
      status: "done",
      completedAt: now,
      updatedAt: now,
    };
    notifyLateCompletion(updated);
    return updated;
  }
  if (!allDone && t.status === "done") {
    const name = getUser(actorUserId)?.name ?? "มีคน";
    logActivity(actorUserId, "เปิดงานกลับ (ยกเลิกเสร็จส่วนตัว)", t.title, t.id, `${name} ยังไม่เสร็จ`);
    return {
      ...t,
      checklist: nextChecklist,
      completedAssigneeIds: nextCompleted,
      status: "in_progress",
      completedAt: undefined,
      reviewedBy: undefined,
      reviewedAt: undefined,
      updatedAt: now,
    };
  }
  if (nextCompleted.length !== prevCompleted.length) {
    logActivity(
      actorUserId,
      nextCompleted.length > prevCompleted.length ? "ทำเครื่องหมายเสร็จ (ส่วนตัว)" : "ยกเลิกเครื่องหมายเสร็จ (ส่วนตัว)",
      t.title,
      t.id,
      `${nextCompleted.length}/${t.assigneeIds.length} คน`
    );
  }
  return { ...t, checklist: nextChecklist, completedAssigneeIds: nextCompleted, updatedAt: now };
}

// Re-exported for callers that only need the constant, not the sweep logic
// itself (which now runs server-side — see /api/tasks/sweep).
export { SYSTEM_USER_ID, LATE_PENALTY_POINTS } from "@/modules/report_task/lib/task-penalty-sweep";

export type PenaltyFilter = "all" | "overdue" | "pending" | "docked";

/**
 * The Task Board's 4 headline cards (TaskBoardKpis), reused as a one-click
 * drill-down filter — "quick" because it's a second, independent axis from
 * the filter bar's own fields below, not a replacement for them. Kept out
 * of `matchesTaskFilters`'s other checks conceptually (still runs through
 * the same predicate) so the KPI cards themselves can be computed with this
 * one dimension forced back to "all" — otherwise selecting e.g. "เลยกำหนด"
 * would collapse all 4 numbers down to the same overdue count instead of
 * staying a stable set of options to click between.
 */
export type QuickView = "all" | "inProgress" | "overdue" | "done";

interface TaskFilters {
  assigneeId: string | "all";
  departmentId: string | "all";
  priority: TaskPriority | "all";
  /** Filter by missed-deadline docking status. */
  penalty: PenaltyFilter;
  /** Due-date range — same `DatePreset` set and `presetRange` helper as the Dashboard's date filter. */
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  quickView: QuickView;
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
  /** Sign-off on a "เสร็จสิ้น" task — see the field's own doc in types/index.ts.
   * No-op if the task isn't currently done (nothing to sign off on). */
  markReviewed: (taskId: string, actorId: string) => void;
  reviseDueDate: (taskId: string, newDate: string, reason: string, revisedBy: string) => void;
  /**
   * Adjusts one assignee's own due-date override on a group task (see
   * `assigneeDueDates`) — logged into `assigneeDueDateRevisions` (first date
   * + latest, not every round) and notifies that assignee, distinct from
   * `reviseDueDate` which revises the shared task-level due date.
   */
  reviseAssigneeDueDate: (taskId: string, assigneeId: string, newDate: string, revisedBy: string) => void;
  /** Same revision as reviseAssigneeDueDate, applied to every current
   * assignee at once with a single log entry instead of one per person —
   * for the "set everyone to the same date" case rather than adjusting one
   * person. Assignees already on that date are left untouched (no-op entry,
   * no spurious revision/notification). */
  reviseAllAssigneeDueDates: (taskId: string, newDate: string, revisedBy: string) => void;
  /**
   * A deliberate "this was marked done but wasn't actually finished"
   * correction — distinct from a normal status change: pulls it out of
   * "เสร็จสิ้น" with a fresh start/due date and a required reason, while the
   * original due date and every prior revision stay intact, and any
   * sticker/penalty already on the task is left untouched.
   */
  selectTask: (id: string | null) => void;
  addTask: (task: Task) => void;
  removeTask: (taskId: string) => void;
  updateTask: (taskId: string, patch: Partial<Task>) => void;
  /** Title/description edit, committed as one logged action (not per
   * keystroke — the UI stages both in local draft state and only calls this
   * on explicit save). */
  saveTaskDetails: (taskId: string, title: string, description: string, actorId: string) => void;
  setPriority: (taskId: string, priority: TaskPriority, actorId: string) => void;
  setStartDate: (taskId: string, startDate: string, actorId: string) => void;
  setAssignees: (taskId: string, assigneeIds: string[]) => void;
  /** Labels one of the task's current assignees as its lead — display-only,
   * no effect on edit/see permissions (those come from assignedById/dept
   * head). No-op if userId isn't actually assigned to the task. */
  setMainAssignee: (taskId: string, userId: string) => void;
  addComment: (taskId: string, message: string, authorId: string, attachments?: Attachment[]) => void;
  removeComment: (taskId: string, commentId: string) => void;
  addAttachment: (taskId: string, attachment: Attachment) => void;
  removeAttachment: (taskId: string, attachmentId: string) => void;
  addChecklistItem: (taskId: string, text: string, ownerId: string) => void;
  /**
   * Toggles one checklist item and recomputes per-assignee completion from
   * the resulting checklist — an assignee's part is done once every item
   * they own is checked, and the task's own status only flips to "done"
   * once every assignee is (see applyChecklistDerivedCompletion). This is
   * now the only way completion happens; there's no separate manual
   * "my part is done" toggle.
   */
  toggleChecklistItem: (taskId: string, itemId: string) => void;
  removeChecklistItem: (taskId: string, itemId: string) => void;
  /**
   * Quick "mark my part done" shortcut (the board card's one-click circle) —
   * flips every checklist item `userId` owns to the opposite of their
   * current all-done state in one batch, then runs the same derived
   * completion as toggling items individually. A no-op if `userId` owns no
   * items on this task.
   */
  toggleAssigneeChecklist: (taskId: string, userId: string) => void;
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

const defaultFilters: TaskFilters = {
  assigneeId: "all",
  departmentId: "all",
  priority: "all",
  penalty: "all",
  preset: "all",
  customFrom: "",
  customTo: "",
  quickView: "all",
};

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: [],
  loaded: false,
  filters: defaultFilters,
  selectedTaskId: null,
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  resetFilters: () => set({ filters: defaultFilters }),
  moveTask: (taskId, status) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId || t.status === status) return t;
        // Hard block — "เสร็จสิ้น" only ever means every assignee's checklist
        // is actually done. Without this, the drag/dropdown/quick-toggle
        // shortcuts could set status="done" straight past the checklist,
        // out of step with the automatic completion path (see
        // applyChecklistDerivedCompletion). Callers check isTaskFullyDone
        // themselves first to show a toast; this is the backstop.
        if (status === "done" && !isTaskFullyDone(t.assigneeIds, t.checklist)) return t;
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
          // Stamp when it actually closed (cleared if it leaves "done" again)
          // so a later sweep can judge lateness by completion time, not "today".
          completedAt: status === "done" ? new Date().toISOString() : undefined,
          // Whatever sign-off existed no longer reflects the current work
          // once a task leaves "เสร็จสิ้น" — see the field's own doc.
          ...(status !== "done" ? { reviewedBy: undefined, reviewedAt: undefined } : {}),
          updatedAt: new Date().toISOString(),
        };
      }),
    })),
  markReviewed: (taskId, actorId) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId || t.status !== "done" || t.reviewedBy) return t;
        logActivity(actorId, "ตรวจสอบแล้วผ่าน", t.title, t.id);
        useNotificationStore
          .getState()
          .notifyMany(t.assigneeIds, actorId, `${getUser(actorId)?.name ?? "หัวหน้า"} ตรวจงาน "${t.title}" แล้วผ่าน`);
        return { ...t, reviewedBy: actorId, reviewedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      }),
    })),
  reviseDueDate: (taskId, newDate, reason, revisedBy) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const revisionNumber = t.revisions.length + 1;
        logActivity(revisedBy, "แก้ไขกำหนดส่ง", t.title, t.id, `${formatShortDate(t.dueDate)} → ${formatShortDate(newDate)} · ${reason}`);
        // Revising the due date on a task already marked "เสร็จสิ้น" means it
        // wasn't actually done — bounce it back to "กำลังทำ" as part of the
        // same edit instead of a separate "เปิดงานใหม่" step (removed —
        // this replaces it).
        const wasDone = t.status === "done";
        return {
          ...t,
          dueDate: newDate,
          ...(wasDone ? { status: "in_progress" as const, completedAt: undefined, reviewedBy: undefined, reviewedAt: undefined } : {}),
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
  reviseAssigneeDueDate: (taskId, assigneeId, newDate, revisedBy) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const previousEffective = t.assigneeDueDates?.[assigneeId] ?? t.dueDate;
        if (previousEffective === newDate) return t;
        const now = new Date().toISOString();
        const existing = t.assigneeDueDateRevisions?.[assigneeId];
        const name = getUser(assigneeId)?.name ?? "มีคน";
        logActivity(
          revisedBy,
          "แก้ไขกำหนดส่งรายบุคคล",
          t.title,
          t.id,
          `${name}: ${formatShortDate(previousEffective)} → ${formatShortDate(newDate)}`
        );
        if (revisedBy !== assigneeId) {
          const actorName = getUser(revisedBy)?.name ?? "มีคน";
          useNotificationStore
            .getState()
            .notifyMany(
              [assigneeId],
              revisedBy,
              `${actorName} ปรับกำหนดส่งของคุณในงาน "${t.title}" เป็น ${formatShortDate(newDate)}`
            );
        }
        return {
          ...t,
          assigneeDueDates: { ...(t.assigneeDueDates ?? {}), [assigneeId]: newDate },
          assigneeDueDateRevisions: {
            ...(t.assigneeDueDateRevisions ?? {}),
            [assigneeId]: {
              originalDate: existing?.originalDate ?? previousEffective,
              latestDate: newDate,
              revisedBy,
              revisedAt: now,
            },
          },
          updatedAt: now,
        };
      }),
    })),
  reviseAllAssigneeDueDates: (taskId, newDate, revisedBy) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const now = new Date().toISOString();
        const nextDates: Record<string, string> = { ...(t.assigneeDueDates ?? {}) };
        const nextRevisions: NonNullable<Task["assigneeDueDateRevisions"]> = { ...(t.assigneeDueDateRevisions ?? {}) };
        const changedIds: string[] = [];
        for (const uid of t.assigneeIds) {
          const previousEffective = t.assigneeDueDates?.[uid] ?? t.dueDate;
          if (previousEffective === newDate) continue;
          changedIds.push(uid);
          nextDates[uid] = newDate;
          const existing = t.assigneeDueDateRevisions?.[uid];
          nextRevisions[uid] = {
            originalDate: existing?.originalDate ?? previousEffective,
            latestDate: newDate,
            revisedBy,
            revisedAt: now,
          };
        }
        if (changedIds.length === 0) return t;
        logActivity(revisedBy, "แก้ไขกำหนดส่งทั้งหมด", t.title, t.id, `ทุกคน (${changedIds.length} คน) → ${formatShortDate(newDate)}`);
        const recipients = changedIds.filter((uid) => uid !== revisedBy);
        if (recipients.length > 0) {
          const actorName = getUser(revisedBy)?.name ?? "มีคน";
          useNotificationStore
            .getState()
            .notifyMany(recipients, revisedBy, `${actorName} ปรับกำหนดส่งของคุณในงาน "${t.title}" เป็น ${formatShortDate(newDate)}`);
        }
        return {
          ...t,
          assigneeDueDates: nextDates,
          assigneeDueDateRevisions: nextRevisions,
          updatedAt: now,
        };
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
  updateTask: (taskId, patch) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t
      ),
    })),
  saveTaskDetails: (taskId, title, description, actorId) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (t) {
        const titleChanged = t.title !== title;
        const descChanged = t.description !== description;
        const what = [titleChanged && "ชื่องาน", descChanged && "รายละเอียด"].filter(Boolean).join(" + ");
        if (what) logActivity(actorId, "แก้ไขข้อมูลงาน", title, taskId, `แก้ไข: ${what}`);
      }
      return {
        tasks: s.tasks.map((x) =>
          x.id === taskId ? { ...x, title, description, updatedAt: new Date().toISOString() } : x
        ),
      };
    }),
  setPriority: (taskId, priority, actorId) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (t && t.priority !== priority) {
        logActivity(actorId, "เปลี่ยนความสำคัญ", t.title, t.id, `${priorityLabel(t.priority)} → ${priorityLabel(priority)}`);
      }
      return {
        tasks: s.tasks.map((x) => (x.id === taskId ? { ...x, priority, updatedAt: new Date().toISOString() } : x)),
      };
    }),
  setStartDate: (taskId, startDate, actorId) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (t && t.startDate !== startDate) {
        logActivity(actorId, "เปลี่ยนวันเริ่มต้น", t.title, t.id, `${formatShortDate(t.startDate)} → ${formatShortDate(startDate)}`);
      }
      return {
        tasks: s.tasks.map((x) => (x.id === taskId ? { ...x, startDate, updatedAt: new Date().toISOString() } : x)),
      };
    }),
  // Assignees drive a task's departments, so recompute them together.
  // taskMode follows the headcount too — 2+ people means it behaves as a
  // group task (per-person checklist completion, done only once everyone
  // is), 1 person means it behaves as an individual task (status settable
  // directly) — so adding/removing assignees is the only control needed,
  // no separate mode toggle for the user to keep in sync by hand.
  setAssignees: (taskId, assigneeIds) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (t && JSON.stringify([...t.assigneeIds].sort()) !== JSON.stringify([...assigneeIds].sort())) {
        const actorId = useIdentityStore.getState().viewingAsUserId;
        const names = assigneeIds.map((id) => getUser(id)?.name).filter(Boolean).join(", ");
        logActivity(actorId, "เปลี่ยนผู้รับผิดชอบ", t.title, t.id, names ? `เป็น ${names}` : "ไม่มีผู้รับผิดชอบ");
        // Going from a solo task to a group one promotes that original
        // person to lead by default (they were already "the" owner before
        // anyone else joined) — only when nobody's been picked yet, so it
        // never overrides a lead someone already set. Worth its own log line
        // since it changes something visible (the ⭐ on their avatar) even
        // though nobody explicitly clicked "ตั้งหัวหน้าหลัก".
        const autoPromoted =
          !t.mainAssigneeId && t.assigneeIds.length === 1 && assigneeIds.length > 1 && assigneeIds.includes(t.assigneeIds[0]!)
            ? t.assigneeIds[0]!
            : null;
        if (autoPromoted) {
          logActivity(actorId, "ตั้งหัวหน้าหลัก", t.title, t.id, `${getUser(autoPromoted)?.name ?? autoPromoted} (อัตโนมัติ — เป็นผู้รับผิดชอบเดิมของงานเดี่ยว)`);
        }
      }
      return {
        tasks: s.tasks.map((x) =>
          x.id === taskId
            ? {
                ...x,
                assigneeIds,
                departmentIds: departmentIdsOf(assigneeIds),
                taskMode: assigneeIds.length > 1 ? "group" : "individual",
                // Unused on an individual task (see the field's own doc
                // comment in types/index.ts) — cleared the moment it shrinks
                // back to one person, not just when that person is dropped,
                // so a solo task never carries a stray ⭐ from when it used
                // to be a group.
                mainAssigneeId:
                  assigneeIds.length <= 1
                    ? undefined
                    : x.mainAssigneeId && assigneeIds.includes(x.mainAssigneeId)
                      ? x.mainAssigneeId
                      : !x.mainAssigneeId && x.assigneeIds.length === 1 && assigneeIds.includes(x.assigneeIds[0]!)
                        ? x.assigneeIds[0]
                        : undefined,
                updatedAt: new Date().toISOString(),
              }
            : x
        ),
      };
    }),
  setMainAssignee: (taskId, userId) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (t && t.assigneeIds.includes(userId) && t.mainAssigneeId !== userId) {
        const actorId = useIdentityStore.getState().viewingAsUserId;
        logActivity(actorId, "ตั้งหัวหน้าหลัก", t.title, t.id, getUser(userId)?.name ?? userId);
      }
      return {
        tasks: s.tasks.map((x) =>
          x.id === taskId && x.assigneeIds.includes(userId)
            ? { ...x, mainAssigneeId: userId, updatedAt: new Date().toISOString() }
            : x
        ),
      };
    }),
  addComment: (taskId, message, authorId, attachments) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id !== taskId
          ? t
          : {
              ...t,
              comments: [
                ...t.comments,
                {
                  id: `${taskId}-cmt-${crypto.randomUUID()}`,
                  authorId,
                  message,
                  createdAt: new Date().toISOString(),
                  ...(attachments && attachments.length > 0 ? { attachments } : {}),
                },
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
  addChecklistItem: (taskId, text, ownerId) =>
    set((s) => {
      const actorId = useIdentityStore.getState().viewingAsUserId;
      return {
        tasks: s.tasks.map((t) => {
          if (t.id !== taskId) return t;
          const nextChecklist = [
            ...t.checklist,
            { id: `${taskId}-chk-${new Date().toISOString().replace(/\D/g, "")}`, text, done: false, ownerId },
          ];
          return applyChecklistDerivedCompletion(t, nextChecklist, actorId);
        }),
      };
    }),
  toggleChecklistItem: (taskId, itemId) =>
    set((s) => {
      const actorId = useIdentityStore.getState().viewingAsUserId;
      return {
        tasks: s.tasks.map((t) => {
          if (t.id !== taskId) return t;
          const nextChecklist = t.checklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c));
          return applyChecklistDerivedCompletion(t, nextChecklist, actorId);
        }),
      };
    }),
  removeChecklistItem: (taskId, itemId) =>
    set((s) => {
      const actorId = useIdentityStore.getState().viewingAsUserId;
      return {
        tasks: s.tasks.map((t) => {
          if (t.id !== taskId) return t;
          const nextChecklist = t.checklist.filter((c) => c.id !== itemId);
          return applyChecklistDerivedCompletion(t, nextChecklist, actorId);
        }),
      };
    }),
  toggleAssigneeChecklist: (taskId, userId) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const mine = t.checklist.filter((c) => c.ownerId === userId);
        if (mine.length === 0) return t;
        const allMineDone = mine.every((c) => c.done);
        const nextChecklist = t.checklist.map((c) => (c.ownerId === userId ? { ...c, done: !allMineDone } : c));
        return applyChecklistDerivedCompletion(t, nextChecklist, userId);
      }),
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
