import { create } from "zustand";
import { departmentIdsOf, departments, getUser, users } from "@/modules/report_task/lib/directory";
import { daysUntil, formatShortDate } from "@/modules/report_task/lib/format";
import { statusMeta, priorityMeta } from "@/modules/report_task/lib/task-meta";
import type { DatePreset } from "@/modules/report_task/lib/date-filter";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useActivityLogStore } from "@/modules/report_task/store/activity-log-store";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";
import { useTaskReviewSettingsStore } from "@/modules/report_task/store/task-review-settings-store";
import { deriveCompletedAssigneeIds, isDoneByRule, isTaskFullyDone } from "@/modules/report_task/lib/task-completion";
import { reactionRecipients } from "@/modules/report_task/lib/sticker-target";
import type { Attachment, ChecklistItem, Task, TaskPriority, TaskProjectLink, TaskRecurrenceRule, TaskStatus } from "@/modules/report_task/types";
import {
  bangkokToday,
  buildRoundTask,
  describeRule,
  formatThaiDate,
  latestOfSeries,
  occurrenceDate,
  scheduledDate,
  templateFromTask,
} from "@/modules/report_task/lib/task-recurrence";
import { uuid } from "@/modules/report_task/lib/uuid";
import { isPersonalTask } from "@/modules/report_task/lib/personal-task";

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

/** a/b เป็นวันที่ ("YYYY-MM-DD" หรือ ISO) — a อยู่หลัง b ระดับวัน */
function isLaterDay(a: string, b: string): boolean {
  return a.slice(0, 10) > b.slice(0, 10);
}

function isEarlierDay(a: string, b: string): boolean {
  return a.slice(0, 10) < b.slice(0, 10);
}

function priorityLabel(p: TaskPriority): string {
  return priorityMeta[p]?.label ?? p;
}

/**
 * งานเข้า "รอตรวจสอบ" (เสร็จแล้ว ยังไม่มีใครตรวจ) — แจ้งทุกคนที่กดตรวจงานนี้ได้จริง ทุกครั้ง
 * ไม่ใช่เฉพาะงานที่ใกล้/เลยกำหนด ("พอรอมาตรวจสอบไม่เห็นเด้งแจ้งเตือนเลย")
 * ผู้ตรวจ = วงเดียวกับปุ่ม "ผ่าน/ไม่ผ่าน" (canReviewTask): เจ้าของบริษัท + ผู้ตรวจเพิ่มเติม +
 * หัวหน้าแผนกของงาน (ถ้าเปิดให้หัวหน้าตรวจ) และผู้มอบหมายงานรู้ด้วย
 * กดแจ้งเตือนแล้วเปิดงานนั้นเลย (?task=) · อยู่ที่นี่ที่เดียว ทุกทางที่ทำให้งานเสร็จ
 * (ลาก, เลือกสถานะ, ติ๊กเช็คลิสต์ครบ) เลยแจ้งเหมือนกันหมด
 */
function notifyReviewReady(task: Task) {
  // งานส่วนตัว (เปิดให้ตัวเอง) ไม่มีใครต้องตรวจ — และชื่องานห้ามหลุดไปหา CEO/หัวหน้า (personal-task.ts)
  if (isPersonalTask(task)) return;
  const days = daysUntil(task.dueDate);
  const actorId = useIdentityStore.getState().viewingAsUserId;
  const actorName = getUser(actorId)?.name ?? "มีคน";
  const settings = useTaskReviewSettingsStore.getState().settings;
  const heads = settings.headsCanReview
    ? departments.filter((d) => task.departmentIds.includes(d.id)).map((d) => d.headId)
    : [];
  const owners = users.filter((u) => u.isOwner).map((u) => u.id);
  const recipients = Array.from(
    new Set([...heads, ...settings.extraReviewerIds, ...owners, task.assignedById].filter((id): id is string => Boolean(id)))
  );
  const late =
    days < 0 ? ` — เลยกำหนดส่งไปแล้ว ${Math.abs(days)} วัน` : days === 0 ? " — ถึงกำหนดส่งวันนี้พอดี" : days <= 2 ? ` — ใกล้ถึงกำหนดส่ง (เหลือ ${days} วัน)` : "";
  useNotificationStore
    .getState()
    .notifyMany(
      recipients,
      actorId,
      `${actorName} ส่งงาน "${task.title}" แล้ว รอคุณตรวจ${late}`,
      undefined,
      `/report-task/tasks?task=${task.id}`,
      undefined,
      undefined,
      task.id
    );
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
/** Every checklist item reset to unchecked — used whenever a task is forced
 * back out of "เสร็จสิ้น" by something other than toggling an item itself
 * (a status change, a rejected review, a revised due date), so the checklist
 * doesn't keep reading "ครบทุกคนแล้ว" once the task is no longer actually
 * done. */
function clearedChecklist(checklist: ChecklistItem[]): ChecklistItem[] {
  return checklist.map((c) => ({ ...c, done: false }));
}

/**
 * แก้กำหนดส่งของงานที่ "ส่งแล้ว" แล้วหัวหน้าเลือก "ส่งกลับให้แก้ไข" — กลับไป "กำลังทำ"
 * เหมือน rejectReview (ล้างเช็คลิสต์ ล้างการตรวจ) · `onlyAssigneeId` = ส่งกลับเฉพาะส่วน
 * ของคนนั้นในงานกลุ่ม (คนอื่นที่ทำเสร็จแล้วไม่ต้องทำซ้ำ)
 */
function sendBackPatch(t: Task, onlyAssigneeId?: string): Partial<Task> {
  const reopen = { status: "in_progress" as const, completedAt: undefined, reviewedBy: undefined, reviewedAt: undefined };
  if (onlyAssigneeId) {
    return {
      ...reopen,
      checklist: t.checklist.map((c) => (c.ownerId === onlyAssigneeId ? { ...c, done: false } : c)),
      completedAssigneeIds: (t.completedAssigneeIds ?? []).filter((id) => id !== onlyAssigneeId),
    };
  }
  return { ...reopen, checklist: clearedChecklist(t.checklist), completedAssigneeIds: [] };
}

/**
 * "ไม่ผ่าน" ของงานกลุ่ม — sweep ตัดสินรายคนด้วย assigneeDueDates และหน้าประวัติของงานกลุ่ม
 * แสดงแค่ assigneeDueDateRevisions · เดิม rejectReview เปลี่ยนแค่ dueDate ของทั้งงาน ⇒ คนที่มี
 * วันรายคนค้างอยู่ (T-2569-0028: 02/10, 05/10) งานเปิดกลับมาแล้วโดนหักทันทีทั้งที่หัวหน้าเลื่อน
 * เป็น 30/10 แล้ว และประวัติไม่ขึ้นรอบนั้น
 *
 * `assigneeDates` = คนที่ส่งกลับ → กำหนดส่งใหม่ของคนนั้น (YYYY-MM-DD) · ไม่ส่งมา = ทุกคนวันเดียวกัน
 * ปิดเมื่อ "ครบทุกคน": ส่งกลับเฉพาะคนที่เลือก คนที่ผ่านแล้วยังนับว่าเสร็จ ไม่ต้องทำซ้ำ
 * ปิดเมื่อ "คนใดคนหนึ่ง": งานชิ้นเดียวกัน ไม่ผ่าน = ทุกคนกลับไปทำ (วันแยกรายคนได้)
 */
function rejectGroupReview(t: Task, newDate: string, reason: string, actorId: string, assigneeDates?: Record<string, string>): Task {
  const fallbackDay = newDate.slice(0, 10);
  const sentBack =
    (t.completionRule ?? "all") === "any" || !assigneeDates
      ? t.assigneeIds
      : t.assigneeIds.filter((uid) => uid in assigneeDates);
  if (sentBack.length === 0) return t;
  const now = new Date().toISOString();
  const nextDates: Record<string, string> = { ...(t.assigneeDueDates ?? {}) };
  const nextRevisions: NonNullable<Task["assigneeDueDateRevisions"]> = { ...(t.assigneeDueDateRevisions ?? {}) };
  const dayOf: Record<string, string> = {};
  for (const uid of sentBack) {
    const previousEffective = t.assigneeDueDates?.[uid] ?? t.dueDate;
    const day = (assigneeDates?.[uid] ?? fallbackDay).slice(0, 10);
    // ไม่ร่นวันใครย้อนหลัง (หน้าจอกันไว้แล้ว — วันขั้นต่ำ = วันนี้หรือวันเดิมของคนนั้น)
    if (!isLaterDay(day, previousEffective)) {
      dayOf[uid] = previousEffective.slice(0, 10);
      continue;
    }
    dayOf[uid] = day;
    nextDates[uid] = day;
    nextRevisions[uid] = {
      originalDate: t.assigneeDueDateRevisions?.[uid]?.originalDate ?? previousEffective,
      latestDate: day,
      revisedBy: actorId,
      revisedAt: now,
    };
  }
  // กำหนดส่งของทั้งงาน = วันที่ช้าที่สุดที่ให้ไป (ไม่ร่นถอยหลัง)
  const latestDay = Object.values(dayOf).reduce((a, b) => (b > a ? b : a), t.dueDate.slice(0, 10));
  const dueDate = isLaterDay(latestDay, t.dueDate) ? new Date(latestDay).toISOString() : t.dueDate;
  const sentBackSet = new Set(sentBack);
  const names = sentBack.map((uid) => `${getUser(uid)?.name ?? "มีคน"} ${formatShortDate(dayOf[uid]!)}`).join(", ");
  logActivity(actorId, "ตรวจสอบแล้วไม่ผ่าน", t.title, t.id, `ส่งกลับ ${names} · ${reason}`);
  const actorName = getUser(actorId)?.name ?? "หัวหน้า";
  for (const uid of sentBack) {
    useNotificationStore
      .getState()
      .notifyMany(
        [uid],
        actorId,
        `${actorName} ตรวจงาน "${t.title}" แล้วไม่ผ่าน — ${reason} (กำหนดส่งใหม่ของคุณ ${formatShortDate(dayOf[uid]!)})`,
        undefined,
        `/report-task/tasks?task=${t.id}`
      );
  }
  return {
    ...t,
    status: "in_progress" as const,
    completedAt: undefined,
    reviewedBy: undefined,
    reviewedAt: undefined,
    // ล้างเช็คลิสต์เฉพาะส่วนของคนที่ส่งกลับ — คนที่ผ่านแล้วไม่ต้องติ๊กใหม่
    checklist: t.checklist.map((c) => (c.ownerId && !sentBackSet.has(c.ownerId) ? c : { ...c, done: false })),
    completedAssigneeIds: (t.completedAssigneeIds ?? []).filter((uid) => !sentBackSet.has(uid)),
    assigneeDueDates: nextDates,
    assigneeDueDateRevisions: nextRevisions,
    dueDate,
    // เหตุผลเดียวกับงานเดี่ยว (ดู rejectReview) — ส่งทันกำหนดเดิมแล้ว ไม่ให้ sweep ตัดสินด้วยวันเดิม
    ...(t.missedDeadlineOnce ? {} : { originalDueDate: dueDate }),
    revisions: [
      ...t.revisions,
      { revisionNumber: t.revisions.length + 1, previousDate: t.dueDate, newDate: dueDate, reason, revisedBy: actorId, revisedAt: now },
    ],
    updatedAt: now,
  };
}

function notifyPenaltyChange(task: Task, byUserId: string, message: string) {
  const heads = departments.filter((d) => task.departmentIds.includes(d.id)).map((d) => d.headId);
  const recipients = Array.from(new Set([...task.assigneeIds, ...heads]));
  useNotificationStore.getState().notifyMany(recipients, byUserId, message, undefined, `/report-task/tasks?task=${task.id}`);
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
function applyChecklistDerivedCompletion(
  t: Task,
  nextChecklist: ChecklistItem[],
  actorUserId: string,
  manuallyDone: string[] = t.completedAssigneeIds ?? [],
): Task {
  const nextCompleted = deriveCompletedAssigneeIds(t.assigneeIds, nextChecklist, manuallyDone);
  const prevCompleted = t.completedAssigneeIds ?? [];
  const rule = t.completionRule ?? "all";
  const allDone = isDoneByRule(t.assigneeIds, nextCompleted, rule);
  const now = new Date().toISOString();

  if (allDone && t.status !== "done") {
    logActivity(
      actorUserId,
      rule === "any" ? "เสร็จสิ้น (มีคนเสร็จแล้ว)" : "เสร็จสิ้น (ครบทุกคน)",
      t.title,
      t.id,
      `${nextCompleted.length}/${t.assigneeIds.length} คน`
    );
    const updated: Task = {
      ...t,
      checklist: nextChecklist,
      completedAssigneeIds: nextCompleted,
      status: "done",
      completedAt: now,
      updatedAt: now,
    };
    notifyReviewReady(updated);
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
 * The Task Board's headline chips (TaskBoardKpis), reused as a one-click
 * drill-down filter — "quick" because it's a second, independent axis from
 * the filter bar's own fields below, not a replacement for them. Kept out
 * of `matchesTaskFilters`'s other checks conceptually (still runs through
 * the same predicate) so the KPI chips themselves can be computed with this
 * one dimension forced back to "all" — otherwise selecting e.g. "รอตรวจสอบ"
 * would collapse every chip down to the same review count instead of
 * staying a stable set of options to click between.
 * "overdue" deliberately overlaps "todo"/"inProgress" (lateness is a
 * property of a not-done task, not a status of its own) — that's fine for a
 * filter chip (clicking it narrows the board same as any other filter), it
 * only became a problem back when these were drawn as 4 big cards that read
 * like a breakdown that had to sum to the total.
 */
export type QuickView = "all" | "todo" | "inProgress" | "overdue" | "review" | "done";

interface TaskFilters {
  assigneeId: string | "all";
  /** Who assigned it — "งานที่กำลังติดตาม" ("งานที่ฉันมอบหมายให้คนอื่นทำ"),
   * see TaskFilterState's own doc in lib/task-filter.ts. */
  assignedById: string | "all";
  departmentId: string | "all";
  priority: TaskPriority | "all";
  /** Filter by missed-deadline docking status. */
  penalty: PenaltyFilter;
  /** Due-date range — same `DatePreset` set and `presetRange` helper as the Dashboard's date filter. */
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  quickView: QuickView;
  /** โปรเจกต์ — ดู TaskFilterState.projectId (lib/task-filter.ts) */
  projectId: string;
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
  /**
   * `sendBack` ใช้กับงานที่ส่งแล้ว (status "done") เท่านั้น: true = ส่งกลับให้แก้ไข
   * (กลับไป "กำลังทำ" กติกาส่งช้าเดียวกับ rejectReview), false = แค่เปลี่ยนวัน คงสถานะไว้
   * ไม่ส่ง = true (พฤติกรรมเดิม)
   */
  reviseDueDate: (taskId: string, newDate: string, reason: string, revisedBy: string, sendBack?: boolean, requestedAt?: string) => void;
  /**
   * Adjusts one assignee's own due-date override on a group task (see
   * `assigneeDueDates`) — logged into `assigneeDueDateRevisions` (first date
   * + latest, not every round) and notifies that assignee, distinct from
   * `reviseDueDate` which revises the shared task-level due date.
   */
  reviseAssigneeDueDate: (
    taskId: string,
    assigneeId: string,
    newDate: string,
    revisedBy: string,
    sendBack?: boolean,
    fromRequest?: { requestedAt: string; previousDate: string }
  ) => void;
  /** Same revision as reviseAssigneeDueDate, applied to every current
   * assignee at once with a single log entry instead of one per person —
   * for the "set everyone to the same date" case rather than adjusting one
   * person. Assignees already on that date are left untouched (no-op entry,
   * no spurious revision/notification). */
  reviseAllAssigneeDueDates: (taskId: string, newDate: string, revisedBy: string, sendBack?: boolean) => void;
  /**
   * The "ไม่ผ่าน" counterpart to markReviewed — a deliberate "this was marked
   * done but wasn't actually finished" correction, distinct from a normal
   * status change: pulls the task out of "เสร็จสิ้น" back to "กำลังทำ", sets
   * `dueDate` to `newDate` (picked via the same DatePickerField as
   * reviseDueDate, not a day-count offset — a real calendar pick reads
   * clearer than mental math on "how many days"), and requires `reason` so
   * the assignee knows what to fix, not just that it bounced. Recorded as a
   * normal revision (see RevisionEntry) so it shows up in the same
   * "ประวัติการแก้ไขกำหนดส่ง" list as any other date change, and any
   * sticker/penalty already on the task is left untouched. No-op if the task
   * isn't currently done or is already reviewed (nothing to reject).
   */
  /** งานกลุ่ม: `assigneeDates` = คนที่ส่งกลับ → กำหนดส่งใหม่ (YYYY-MM-DD) — ดู rejectGroupReview */
  rejectReview: (taskId: string, newDate: string, reason: string, actorId: string, assigneeDates?: Record<string, string>) => void;
  /**
   * ผู้รับผิดชอบขอเลื่อนกำหนดส่ง (คนที่แก้เองไม่ได้) — แจ้ง CEO ทุกคน ยังไม่เปลี่ยนวันจนกว่าจะอนุมัติ
   * ขอซ้ำระหว่างรออยู่ = แทนคำขอเดิมของคนนั้น (ไม่กองหลายใบ) · newDate = YYYY-MM-DD
   */
  requestDueDateChange: (taskId: string, requesterId: string, newDate: string, reason: string) => void;
  /** ผู้ขอยกเลิกคำขอที่ยังรออยู่ */
  cancelDueDateRequest: (taskId: string, requestId: string, actorId: string) => void;
  /**
   * CEO อนุมัติ/ไม่อนุมัติ — อนุมัติ = เปลี่ยนวันจริงผ่าน reviseDueDate (งานเดี่ยว) หรือ
   * reviseAssigneeDueDate (งานกลุ่ม: วันของผู้ขอ) แจ้งผลกลับผู้ขอทั้งสองกรณี · note ไม่บังคับ
   */
  decideDueDateRequest: (taskId: string, requestId: string, deciderId: string, approve: boolean, note?: string) => void;
  selectTask: (id: string | null) => void;
  addTask: (task: Task) => void;
  removeTask: (taskId: string) => void;
  /** งานทำซ้ำ: ข้ามรอบนี้ (ลบ ไม่หักคะแนน) แล้วเอารอบถัดไปขึ้นบอร์ดทันที — คืน id รอบใหม่ (null = ไม่มีรอบถัดไป) */
  skipRecurringRound: (taskId: string, actorId: string) => string | null;
  /** งานทำซ้ำ: หยุดสร้างรอบใหม่ทั้งชุด · deleteThis = ลบรอบนี้ด้วย */
  stopRecurrence: (taskId: string, deleteThis: boolean, actorId: string) => void;
  /** งานทำซ้ำ: เปลี่ยนตาราง (มีผลตั้งแต่รอบถัดไป) */
  updateRecurrence: (taskId: string, rule: TaskRecurrenceRule, actorId: string) => void;
  /** โปรเจกต์: ผูก/ย้าย/ถอดงานออกจากโปรเจกต์ (ช่วงงาน + งานที่ต้องรอ) */
  setTaskProject: (taskId: string, link: TaskProjectLink | null, actorId: string) => void;
  /** โปรเจกต์: เลื่อนวันจาก Timeline — กำหนดส่งเปลี่ยน = บันทึกเป็นการเลื่อนกำหนด (มีประวัติ) แบบ reviseDueDate
   * ต่างตรงที่ย้อนให้เร็วขึ้นได้ (วางแผนใหม่) แต่ไม่ย้อนไปก่อนวันนี้ · คนเรียกต้องเช็คสิทธิ์เอง (เจ้าของโปรเจกต์/CEO) */
  rescheduleTask: (taskId: string, startDate: string, dueDate: string, reason: string, actorId: string) => void;
  /** งานทำซ้ำ: เลื่อนวันของรอบ n ที่ยังไม่ขึ้นบอร์ด · date null = กลับเป็นวันตามตาราง */
  setRoundDate: (taskId: string, n: number, date: string | null, actorId: string) => void;
  updateTask: (taskId: string, patch: Partial<Task>) => void;
  /** Title/description edit, committed as one logged action (not per
   * keystroke — the UI stages both in local draft state and only calls this
   * on explicit save). */
  saveTaskDetails: (taskId: string, title: string, description: string, actorId: string) => void;
  setPriority: (taskId: string, priority: TaskPriority, actorId: string) => void;
  setStartDate: (taskId: string, startDate: string, actorId: string) => void;
  /** R8 — the create dialog is the only place `dueTime` could be set before
   * this; once a task existed there was no way back in short of deleting and
   * recreating it. `""` clears it (falls back to 23:59 for the reminder
   * sweep — see reminder-sweep.ts). Not folded into `reviseDueDate`'s
   * reason-required flow: this is reminder-timing metadata, not the actual
   * deadline date, so it doesn't need the same audit trail. */
  setDueTime: (taskId: string, dueTime: string, actorId: string) => void;
  setAssignees: (taskId: string, assigneeIds: string[]) => void;
  /** Labels one of the task's current assignees as its lead — display-only,
   * no effect on edit/see permissions (those come from assignedById/dept
   * head). No-op if userId isn't actually assigned to the task. */
  setMainAssignee: (taskId: string, userId: string) => void;
  /** mentionIds: คนที่ถูก @แท็กในความคิดเห็น — ได้แจ้งเตือน "แท็กคุณ" แทนแจ้งเตือนความคิดเห็นทั่วไป */
  addComment: (taskId: string, message: string, authorId: string, attachments?: Attachment[], mentionIds?: string[]) => void;
  removeComment: (taskId: string, commentId: string) => void;
  /** แนบไฟล์ทีละชุด (เลือกหลายไฟล์พร้อมกัน) — เพิ่มทีละไฟล์ได้ แต่แจ้งเตือนครั้งเดียวต่อชุด */
  addAttachments: (taskId: string, attachments: Attachment[]) => void;
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
  /** targetUserId: งานกลุ่ม ส่งให้คนนี้คนเดียว (ไม่ส่ง = ทั้งกลุ่ม) */
  addReaction: (taskId: string, stickerId: string, byUserId: string, note?: string, targetUserId?: string) => void;
  removeReaction: (taskId: string, reactionId: string) => void;
  /** Plain no-score reaction — anyone toggles their own id in/out of that
   * emoji's list, same shape/behavior as a report post's emoji reactions. */
  toggleEmojiReaction: (taskId: string, emoji: string, userId: string) => void;
  /** "ติดตามงานนี้" — toggles the caller's own id in/out of watcherIds; the
   * store itself doesn't gate who's allowed (that's task-detail-sheet.tsx's
   * canWatch — department head/CEO only, see Task.watcherIds's own doc). No
   * score effect, same spirit as toggleEmojiReaction just tracked separately
   * from reactions. */
  toggleWatcher: (taskId: string, userId: string) => void;
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
  assignedById: "all",
  departmentId: "all",
  priority: "all",
  penalty: "all",
  preset: "all",
  customFrom: "",
  customTo: "",
  quickView: "all",
  // งานโปรเจกต์อยู่หน้าโปรเจกต์ ไม่ปนบนบอร์ดงาน — เลือก "ทุกงาน" ในตัวกรองเพื่อดูรวม
  projectId: "none",
};

export const useTaskStore = create<TaskStore>((set, get) => ({
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
        if (status === "done" && !isTaskFullyDone(t.assigneeIds, t.checklist, t.completionRule, t.completedAssigneeIds)) return t;
        if (status === "done") notifyReviewReady(t);
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
          // Reopening a done task past the checklist itself (not through
          // toggling an item, which would recompute this naturally) leaves
          // every box still ticked — the card then reads "ครบทุกคนแล้ว" while
          // sitting outside "รอตรวจสอบ"/"เสร็จสิ้น", which looks broken. Clear
          // it back to unstarted so what's on screen matches where the task
          // actually landed.
          ...(status !== "done" && t.status === "done" ? { checklist: clearedChecklist(t.checklist), completedAssigneeIds: [] } : {}),
          // ไม่มีเช็คลิสต์ = ปิดทั้งงานจาก dropdown/ลากการ์ด — บันทึกว่าทุกคนเสร็จด้วย
          // ไม่งั้นสถานะ "เสร็จสิ้น" แต่รายชื่อผู้รับผิดชอบขึ้น "ยังไม่เสร็จ 0/N"
          ...(status === "done" && t.checklist.length === 0 ? { completedAssigneeIds: t.assigneeIds } : {}),
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
          .notifyMany(t.assigneeIds, actorId, `${getUser(actorId)?.name ?? "หัวหน้า"} ตรวจงาน "${t.title}" แล้วผ่าน`, undefined, `/report-task/tasks?task=${t.id}`);
        return { ...t, reviewedBy: actorId, reviewedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      }),
    })),
  rejectReview: (taskId, newDate, reason, actorId, assigneeDates) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId || t.status !== "done" || t.reviewedBy) return t;
        if (t.taskMode === "group") return rejectGroupReview(t, newDate, reason, actorId, assigneeDates);
        if (isEarlierDay(newDate, t.dueDate)) return t;
        const previousDate = t.dueDate;
        const revisionNumber = t.revisions.length + 1;
        logActivity(
          actorId,
          "ตรวจสอบแล้วไม่ผ่าน",
          t.title,
          t.id,
          `${formatShortDate(previousDate)} → ${formatShortDate(newDate)} · ${reason}`
        );
        useNotificationStore
          .getState()
          .notifyMany(
            t.assigneeIds,
            actorId,
            `${getUser(actorId)?.name ?? "หัวหน้า"} ตรวจงาน "${t.title}" แล้วไม่ผ่าน — ${reason} (เลื่อนกำหนดเป็น ${formatShortDate(newDate)})`,
            undefined,
            `/report-task/tasks?task=${t.id}`
          );
        return {
          ...t,
          status: "in_progress" as const,
          completedAt: undefined,
          // A rejected review means the work isn't actually acceptable —
          // leaving every checklist box ticked would keep reading as "ครบทุก
          // คนแล้ว" right after being sent back for more work.
          checklist: clearedChecklist(t.checklist),
          completedAssigneeIds: [],
          dueDate: newDate,
          // task-penalty-sweep.ts judges "overdue" against `originalDueDate`,
          // not the current one, on purpose — so someone can't dodge a still-
          // pending miss by nudging the date forward. That guard backfires
          // here: if the assignee genuinely hit the original deadline
          // (`!missedDeadlineOnce`) and review just happened to land after it
          // had passed, reopening the task would make the next sweep see it
          // as newly overdue against a deadline they already met, and dock
          // them for a review delay that was never theirs. Only reset it in
          // that case — a task that had ALREADY blown its original deadline
          // keeps that date, same as reviseDueDate, so real lateness stays on
          // the record instead of being quietly erased by a rejection.
          ...(t.missedDeadlineOnce ? {} : { originalDueDate: newDate }),
          reviewedBy: undefined,
          reviewedAt: undefined,
          revisions: [
            ...t.revisions,
            { revisionNumber, previousDate, newDate, reason, revisedBy: actorId, revisedAt: new Date().toISOString() },
          ],
          updatedAt: new Date().toISOString(),
        };
      }),
    })),
  reviseDueDate: (taskId, newDate, reason, revisedBy, sendBack = true, requestedAt) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId) return t;
        // กำหนดส่งย้อนไปก่อนวันเดิมไม่ได้ (ทั้งหัวหน้าแก้ตรงและอนุมัติคำขอ) — เคยพิมพ์ผิด
        // 30/09 → 04/09 แล้วกำหนดส่งไปอยู่ในอดีต ⇒ โดนหักคะแนนทันที
        if (isEarlierDay(newDate, t.dueDate)) return t;
        const revisionNumber = t.revisions.length + 1;
        logActivity(revisedBy, "แก้ไขกำหนดส่ง", t.title, t.id, `${formatShortDate(t.dueDate)} → ${formatShortDate(newDate)}${reason ? ` · ${reason}` : ""}`);
        // เดิมฟังก์ชันนี้ไม่แจ้งใครเลย ต่างจาก reviseAssigneeDueDate/
        // reviseAllAssigneeDueDates (พี่น้องกันที่แก้ไขกำหนดส่งเหมือนกันแค่
        // คนละระดับ) ที่แจ้งอยู่แล้ว — "หัวหน้ากดแก้ไขแต่ไม่เห็นแจ้งเตือนไปยัง
        // ผู้ที่ได้รับมอบหมายเลย" คือจุดนี้เอง ไม่ใช่แค่ตกหล่นตอน reject review
        const actorName = getUser(revisedBy)?.name ?? "มีคน";
        useNotificationStore
          .getState()
          .notifyMany(t.assigneeIds, revisedBy, `${actorName} ปรับกำหนดส่งงาน "${t.title}" เป็น ${formatShortDate(newDate)}${reason ? ` — ${reason}` : ""}`, undefined, `/report-task/tasks?task=${t.id}`);
        // งานที่ส่งแล้ว: หัวหน้าเลือกเองว่า "ส่งกลับให้แก้ไข" (กลับไป "กำลังทำ") หรือ
        // "แค่เปลี่ยนวัน" (คงสถานะรอตรวจ — เดิมเด้งกลับเสมอ ลูกน้องต้องติ๊กเช็คลิสต์
        // แล้วกดส่งใหม่ทั้งที่ไม่ได้มีงานเพิ่ม)
        //
        // ส่งกลับ + ส่งครั้งแรกทันกำหนด ⇒ ยึดวันใหม่ (originalDueDate) เหมือน rejectReview
        // เดิมทางนี้ไม่ย้าย ⇒ กดหลังกำหนดเดิมผ่านไปแล้ว sweep เห็นงานเปิดอยู่เลยกำหนดเดิม
        // แล้วหักคะแนนคนที่ส่งทันตั้งแต่แรก · ส่งครั้งแรกช้าอยู่แล้วยังยึดวันเดิม (ความช้ายังอยู่)
        const bounce = t.status === "done" && sendBack;
        return {
          ...t,
          dueDate: newDate,
          ...(bounce ? sendBackPatch(t) : {}),
          ...(bounce && !t.missedDeadlineOnce ? { originalDueDate: newDate } : {}),
          revisions: [
            ...t.revisions,
            {
              revisionNumber,
              previousDate: t.dueDate,
              newDate,
              reason,
              revisedBy,
              revisedAt: new Date().toISOString(),
              ...(requestedAt ? { requestedAt } : {}),
            },
          ],
          updatedAt: new Date().toISOString(),
        };
      }),
    })),
  requestDueDateChange: (taskId, requesterId, newDate, reason) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const now = new Date().toISOString();
        const previousDate = t.taskMode === "group" ? (t.assigneeDueDates?.[requesterId] ?? t.dueDate) : t.dueDate;
        // ขอเลื่อนได้แค่ไปข้างหน้า (หน้าจอกันไว้แล้ว — กันซ้ำตรงนี้)
        if (!isLaterDay(newDate, previousDate)) return t;
        const request = { id: `ddr-${uuid()}`, requestedBy: requesterId, requestedAt: now, newDate, previousDate, reason, status: "pending" as const };
        const others = (t.dueDateRequests ?? []).filter((r) => !(r.requestedBy === requesterId && r.status === "pending"));
        const name = getUser(requesterId)?.name ?? "มีคน";
        logActivity(requesterId, "ขอเลื่อนกำหนดส่ง", t.title, t.id, `${formatShortDate(previousDate)} → ${formatShortDate(newDate)} · ${reason}`);
        // คนที่อนุมัติได้: CEO + ผู้มอบหมาย + หัวหน้าแผนกของงาน (ตรงกับ canEditRecord) — ไม่รวมคนขอเอง
        const approverIds = [
          ...new Set([
            ...users.filter((u) => u.isOwner).map((u) => u.id),
            ...(t.assignedById ? [t.assignedById] : []),
            ...departments.filter((d) => d.headId && t.departmentIds.includes(d.id)).map((d) => d.headId as string),
          ]),
        ].filter((id) => id !== requesterId && !isPersonalTask(t));
        useNotificationStore
          .getState()
          .notifyMany(
            approverIds,
            requesterId,
            `${name} ขอเลื่อนกำหนดส่งงาน "${t.title}" จาก ${formatShortDate(previousDate)} เป็น ${formatShortDate(newDate)} — ${reason}`,
            undefined,
            `/report-task/tasks?task=${t.id}`,
            undefined,
            "task_due_request",
            t.id
          );
        return { ...t, dueDateRequests: [...others, request], updatedAt: now };
      }),
    })),

  cancelDueDateRequest: (taskId, requestId, actorId) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const now = new Date().toISOString();
        return {
          ...t,
          dueDateRequests: (t.dueDateRequests ?? []).map((r) =>
            r.id === requestId && r.status === "pending" && r.requestedBy === actorId ? { ...r, status: "cancelled" as const, decidedAt: now } : r
          ),
          updatedAt: now,
        };
      }),
    })),

  decideDueDateRequest: (taskId, requestId, deciderId, approve, note) => {
    const task = useTaskStore.getState().tasks.find((t) => t.id === taskId);
    const request = task?.dueDateRequests?.find((r) => r.id === requestId);
    if (!task || !request || request.status !== "pending") return;
    // คำขอที่ย้อนวันกลับ (สร้างก่อนมีตัวกันในหน้าจอ) อนุมัติไม่ได้ — ปฏิเสธได้อย่างเดียว
    if (approve && !isLaterDay(request.newDate, request.previousDate)) return;
    const now = new Date().toISOString();
    const cleanNote = note?.trim() || undefined;
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id !== taskId
          ? t
          : {
              ...t,
              dueDateRequests: (t.dueDateRequests ?? []).map((r) =>
                r.id === requestId
                  ? { ...r, status: approve ? ("approved" as const) : ("rejected" as const), decidedBy: deciderId, decidedAt: now, ...(cleanNote ? { decisionNote: cleanNote } : {}) }
                  : r
              ),
              updatedAt: now,
            }
      ),
    }));
    const requesterName = getUser(request.requestedBy)?.name ?? "ผู้ขอ";
    const deciderName = getUser(deciderId)?.name ?? "หัวหน้า";
    if (approve) {
      // เปลี่ยนวันจริงด้วยทางเดิมของการแก้กำหนดส่ง — ประวัติ/บันทึกกิจกรรม/แจ้งผู้รับผิดชอบเหมือนแก้ตรง
      // sendBack = false: แค่เลื่อนวัน ไม่ดึงงานที่ส่งแล้วกลับไปแก้
      if (task.taskMode === "group") {
        useTaskStore.getState().reviseAssigneeDueDate(taskId, request.requestedBy, request.newDate, deciderId, false, {
          requestedAt: request.requestedAt,
          previousDate: request.previousDate,
        });
      } else {
        useTaskStore
          .getState()
          .reviseDueDate(taskId, new Date(request.newDate).toISOString(), `อนุมัติคำขอของ ${requesterName}: ${request.reason}`, deciderId, false, request.requestedAt);
      }
    }
    logActivity(
      deciderId,
      approve ? "อนุมัติคำขอเลื่อนกำหนดส่ง" : "ไม่อนุมัติคำขอเลื่อนกำหนดส่ง",
      task.title,
      taskId,
      `${requesterName}: ${formatShortDate(request.previousDate)} → ${formatShortDate(request.newDate)}${cleanNote ? ` · ${cleanNote}` : ""}`
    );
    useNotificationStore
      .getState()
      .notifyMany(
        [request.requestedBy],
        deciderId,
        approve
          ? `${deciderName} อนุมัติให้เลื่อนกำหนดส่งงาน "${task.title}" เป็น ${formatShortDate(request.newDate)}${cleanNote ? ` — ${cleanNote}` : ""}`
          : `${deciderName} ไม่อนุมัติการเลื่อนกำหนดส่งงาน "${task.title}"${cleanNote ? ` — ${cleanNote}` : ""} (กำหนดส่งเดิม ${formatShortDate(request.previousDate)})`,
        undefined,
        `/report-task/tasks?task=${taskId}`,
        undefined,
        "task_due_request",
        taskId
      );
  },

  reviseAssigneeDueDate: (taskId, assigneeId, newDate, revisedBy, sendBack = false, fromRequest) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const previousEffective = t.assigneeDueDates?.[assigneeId] ?? t.dueDate;
        if (isEarlierDay(newDate, previousEffective)) return t;
        // ส่งกลับให้แก้ไขได้แม้วันไม่เปลี่ยน — ตัวเลือกนี้ไม่ใช่แค่เรื่องวัน
        const partSubmitted = t.status === "done" || (t.completedAssigneeIds ?? []).includes(assigneeId);
        const bounce = sendBack && partSubmitted;
        if (previousEffective === newDate && !bounce) return t;
        const now = new Date().toISOString();
        const existing = t.assigneeDueDateRevisions?.[assigneeId];
        const name = getUser(assigneeId)?.name ?? "มีคน";
        logActivity(
          revisedBy,
          "แก้ไขกำหนดส่งรายบุคคล",
          t.title,
          t.id,
          `${name}: ${formatShortDate(previousEffective)} → ${formatShortDate(newDate)}${bounce ? " · ส่งกลับให้แก้ไข" : ""}`
        );
        if (revisedBy !== assigneeId) {
          const actorName = getUser(revisedBy)?.name ?? "มีคน";
          useNotificationStore
            .getState()
            .notifyMany(
              [assigneeId],
              revisedBy,
              bounce
                ? `${actorName} ส่งงาน "${t.title}" (ส่วนของคุณ) กลับให้แก้ไข — กำหนดส่งใหม่ ${formatShortDate(newDate)}`
                : `${actorName} ปรับกำหนดส่งของคุณในงาน "${t.title}" เป็น ${formatShortDate(newDate)}`,
              undefined,
              `/report-task/tasks?task=${t.id}`
            );
        }
        // งานกลุ่ม: sweep ตัดสินรายคนด้วย assigneeDueDates ของคนนั้นอยู่แล้ว ⇒ ส่งกลับแล้ว
        // ยึดวันใหม่นี้เอง ไม่ต้องขยับ originalDueDate ของทั้งงาน
        return {
          ...t,
          ...(bounce ? sendBackPatch(t, assigneeId) : {}),
          assigneeDueDates: { ...(t.assigneeDueDates ?? {}), [assigneeId]: newDate },
          assigneeDueDateRevisions: {
            ...(t.assigneeDueDateRevisions ?? {}),
            [assigneeId]: {
              originalDate: existing?.originalDate ?? previousEffective,
              latestDate: newDate,
              revisedBy,
              revisedAt: now,
              // อนุมัติจากคำขอ ⇒ จำเวลาที่ขอ (sweep ใช้ตัดสินว่าขอทันกำหนดเดิมไหม) · แก้ตรงเอง = ไม่มี
              ...(fromRequest ? { requestedAt: fromRequest.requestedAt, requestPreviousDate: fromRequest.previousDate } : {}),
            },
          },
          updatedAt: now,
        };
      }),
    })),
  reviseAllAssigneeDueDates: (taskId, newDate, revisedBy, sendBack = false) =>
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
          // ไม่ร่นวันของใครย้อนหลัง (หน้าจอกันไว้แล้ว — คนที่วันเดิมช้ากว่าคงไว้)
          if (isEarlierDay(newDate, previousEffective)) continue;
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
        const bounce = sendBack && t.status === "done";
        if (changedIds.length === 0 && !bounce) return t;
        logActivity(
          revisedBy,
          "แก้ไขกำหนดส่งทั้งหมด",
          t.title,
          t.id,
          `ทุกคน (${changedIds.length} คน) → ${formatShortDate(newDate)}${bounce ? " · ส่งกลับให้แก้ไข" : ""}`
        );
        const recipients = (bounce ? t.assigneeIds : changedIds).filter((uid) => uid !== revisedBy);
        if (recipients.length > 0) {
          const actorName = getUser(revisedBy)?.name ?? "มีคน";
          useNotificationStore
            .getState()
            .notifyMany(
              recipients,
              revisedBy,
              bounce
                ? `${actorName} ส่งงาน "${t.title}" กลับให้แก้ไข — กำหนดส่งใหม่ ${formatShortDate(newDate)}`
                : `${actorName} ปรับกำหนดส่งของคุณในงาน "${t.title}" เป็น ${formatShortDate(newDate)}`,
              undefined,
              `/report-task/tasks?task=${t.id}`
            );
        }
        return {
          ...t,
          ...(bounce ? sendBackPatch(t) : {}),
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
    // งานที่เพิ่งสร้างไม่เคยแจ้งผู้รับผิดชอบเลยมาก่อน — เห็นแค่ตอนเปิดบอร์ด
    // เอง ไม่มีอะไรขึ้นทั้งกระดิ่งและ badge เมนู ("เวลามีคนมอบหมายงานมาทำไม
    // ตรงที่วงไม่ขึ้นแดง") notifyMany เองก็ข้าม self-notify ให้แล้ว (คนสร้าง
    // มอบงานให้ตัวเองไม่ต้องเตือนตัวเอง)
    if (task.assigneeIds.length > 0) {
      const actorName = getUser(task.assignedById)?.name ?? "หัวหน้า";
      useNotificationStore
        .getState()
        .notifyMany(
          task.assigneeIds,
          task.assignedById,
          `${actorName} มอบหมายงาน "${task.title}" ให้คุณ`,
          undefined,
          `/report-task/tasks?task=${task.id}`,
          undefined,
          "task_assigned",
          task.id
        );
    }
    set((s) => ({ tasks: [task, ...s.tasks] }));
  },
  skipRecurringRound: (taskId, actorId) => {
    const s = get();
    const cur = s.tasks.find((x) => x.id === taskId);
    if (!cur?.recurrence) return null;
    const latest = latestOfSeries(s.tasks, cur.recurrence.seriesId) ?? cur;
    const rec = latest.recurrence!;
    // รอบถัดไปที่ยังไม่มีงาน และกำหนดส่งยังไม่ผ่าน — ขึ้นบอร์ดทันที (ไม่รอถึงวันขึ้นบอร์ด)
    const today = bangkokToday();
    let n = Math.max(rec.occurrence, cur.recurrence.occurrence) + 1;
    let due = occurrenceDate(rec.rule, n);
    while (due && due < today) due = occurrenceDate(rec.rule, ++n);
    const next =
      due && !rec.stopped
        ? buildRoundTask(latest, n, due, { taskId: `task-${uuid()}`, checklistId: () => `task-chk-${uuid()}` }, new Date().toISOString())
        : null;
    logActivity(actorId, "ข้ามรอบงานทำซ้ำ", cur.title, cur.id, `รอบที่ ${cur.recurrence.occurrence}${next ? ` → รอบที่ ${n} ขึ้นบอร์ดแล้ว` : " (ไม่มีรอบถัดไป)"}`);
    useNotificationStore.getState().removeTaskNotifications(taskId);
    if (next && next.assigneeIds.length > 0) {
      const actorName = getUser(actorId)?.name ?? "หัวหน้า";
      useNotificationStore
        .getState()
        .notifyMany(
          next.assigneeIds,
          actorId,
          `${actorName} ข้ามรอบงาน "${next.title}" — รอบที่ ${n} มาแล้ว · ส่งภายใน ${formatThaiDate(due!, false)}`,
          undefined,
          `/report-task/tasks?task=${next.id}`,
          undefined,
          "task_assigned",
          next.id
        );
    }
    set((st) => ({ tasks: [...(next ? [next] : []), ...st.tasks.filter((x) => x.id !== taskId)] }));
    return next?.id ?? null;
  },
  stopRecurrence: (taskId, deleteThis, actorId) =>
    set((s) => {
      const cur = s.tasks.find((x) => x.id === taskId);
      if (!cur?.recurrence) return {};
      const seriesId = cur.recurrence.seriesId;
      logActivity(actorId, deleteThis ? "ลบรอบนี้และหยุดทำซ้ำ" : "หยุดทำซ้ำ", cur.title, cur.id, `รอบที่ ${cur.recurrence.occurrence}`);
      if (deleteThis) useNotificationStore.getState().removeTaskNotifications(taskId);
      const now = new Date().toISOString();
      return {
        tasks: s.tasks
          .filter((x) => !(deleteThis && x.id === taskId))
          .map((x) =>
            x.recurrence?.seriesId === seriesId ? { ...x, recurrence: { ...x.recurrence, stopped: true }, updatedAt: now } : x
          ),
      };
    }),
  updateRecurrence: (taskId, rule, actorId) =>
    set((s) => {
      const cur = s.tasks.find((x) => x.id === taskId);
      if (!cur?.recurrence) return {};
      const latest = latestOfSeries(s.tasks, cur.recurrence.seriesId) ?? cur;
      logActivity(actorId, "แก้การทำซ้ำ", cur.title, cur.id, describeRule(rule));
      const now = new Date().toISOString();
      return {
        tasks: s.tasks.map((x) =>
          x.id === latest.id
            ? { ...x, recurrence: { ...x.recurrence!, rule, stopped: false, template: templateFromTask(x) }, updatedAt: now }
            : x
        ),
      };
    }),
  setTaskProject: (taskId, link, actorId) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (!t) return {};
      if ((t.project?.projectId ?? null) !== (link?.projectId ?? null)) {
        logActivity(actorId, link ? "เพิ่มงานเข้าโปรเจกต์" : "เอางานออกจากโปรเจกต์", t.title, t.id);
      }
      return {
        tasks: s.tasks.map((x) => {
          if (x.id === taskId) {
            if (!link) { const { project: _p, ...rest } = x; return { ...rest, updatedAt: new Date().toISOString() }; }
            return { ...x, project: link, updatedAt: new Date().toISOString() };
          }
          // ถอดออกจากโปรเจกต์ → งานอื่นที่รองานนี้อยู่เลิกรอ
          if (!link && x.project?.dependsOn?.includes(taskId)) {
            const { [taskId]: _gone, ...rules } = x.project.depRules ?? {};
            return { ...x, project: { ...x.project, dependsOn: x.project.dependsOn.filter((d) => d !== taskId), ...(x.project.depRules ? { depRules: rules } : {}) } };
          }
          return x;
        }),
      };
    }),
  rescheduleTask: (taskId, startDate, dueDate, reason, actorId) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (!t) return {};
      const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
      const newDue = dueDate.slice(0, 10) < today && t.dueDate.slice(0, 10) >= today ? `${today}T00:00:00.000Z` : dueDate;
      const dueChanged = newDue.slice(0, 10) !== t.dueDate.slice(0, 10);
      const startChanged = startDate.slice(0, 10) !== t.startDate.slice(0, 10);
      if (!dueChanged && !startChanged) return {};
      const now = new Date().toISOString();
      if (dueChanged) {
        logActivity(actorId, "แก้ไขกำหนดส่ง", t.title, t.id, `${formatShortDate(t.dueDate)} → ${formatShortDate(newDue)} · ${reason}`);
        const actorName = getUser(actorId)?.name ?? "มีคน";
        useNotificationStore
          .getState()
          .notifyMany(t.assigneeIds, actorId, `${actorName} ปรับกำหนดส่งงาน "${t.title}" เป็น ${formatShortDate(newDue)} — ${reason}`, undefined, `/report-task/tasks?task=${t.id}`);
      } else {
        logActivity(actorId, "เปลี่ยนวันเริ่มต้น", t.title, t.id, `${formatShortDate(t.startDate)} → ${formatShortDate(startDate)}`);
      }
      return {
        tasks: s.tasks.map((x) =>
          x.id !== taskId
            ? x
            : {
                ...x,
                startDate: startDate > newDue ? newDue : startDate,
                dueDate: newDue,
                ...(dueChanged
                  ? {
                      revisions: [
                        ...x.revisions,
                        { revisionNumber: x.revisions.length + 1, previousDate: x.dueDate, newDate: newDue, reason, revisedBy: actorId, revisedAt: now },
                      ],
                    }
                  : {}),
                updatedAt: now,
              }
        ),
      };
    }),
  setRoundDate: (taskId, n, date, actorId) =>
    set((s) => {
      const cur = s.tasks.find((x) => x.id === taskId);
      if (!cur?.recurrence) return {};
      const latest = latestOfSeries(s.tasks, cur.recurrence.seriesId) ?? cur;
      const rule = latest.recurrence!.rule;
      const overrides = { ...(rule.dateOverrides ?? {}) };
      if (date && date !== scheduledDate(rule, n)) overrides[String(n)] = date;
      else delete overrides[String(n)];
      logActivity(actorId, "แก้วันรอบงานทำซ้ำ", cur.title, cur.id, `รอบที่ ${n} → ${formatThaiDate(date ?? scheduledDate(rule, n) ?? "")}${date ? "" : " (กลับเป็นวันปกติ)"}`);
      const now = new Date().toISOString();
      return {
        tasks: s.tasks.map((x) =>
          x.id === latest.id
            ? {
                ...x,
                recurrence: {
                  ...x.recurrence!,
                  rule: { ...rule, dateOverrides: Object.keys(overrides).length ? overrides : undefined },
                },
                updatedAt: now,
              }
            : x
        ),
      };
    }),
  removeTask: (taskId) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (t) logActivity(useIdentityStore.getState().viewingAsUserId, "ลบงาน", t.title, t.id);
      // เก็บกวาดแจ้งเตือนของงานนี้ด้วย ไม่งั้นกระดิ่ง/badge เมนูค้างชี้ไปงานที่
      // ลบไปแล้ว ("ลบงานไปแล้วแต่ทำไมแจ้งเตือนยังขึ้น") — ดู notification-store.ts's
      // removeTaskNotifications เรื่อง doc ว่าจับคู่ยังไง
      useNotificationStore.getState().removeTaskNotifications(taskId);
      // งานย่อยของงานที่ลบ — เหลือเป็นงานธรรมดา (ไม่ลบตาม งานที่มอบให้คนอื่นไม่ควรหายเงียบ ๆ)
      return {
        tasks: s.tasks
          .filter((x) => x.id !== taskId)
          .map((x) => {
            if (x.parentId !== taskId) return x;
            const { parentId: _p, ...rest } = x;
            return rest;
          }),
      };
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
  setDueTime: (taskId, dueTime, actorId) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (t && (t.dueTime ?? "") !== dueTime) {
        logActivity(actorId, "เปลี่ยนเวลากำหนดส่ง", t.title, t.id, dueTime ? dueTime : "ไม่ระบุเวลา");
      }
      return {
        tasks: s.tasks.map((x) => (x.id === taskId ? { ...x, dueTime: dueTime || undefined, updatedAt: new Date().toISOString() } : x)),
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
        const nameList = (ids: string[]) => ids.map((id) => getUser(id)?.name ?? id).join(", ");
        const remaining = assigneeIds.length > 0 ? `เหลือ ${nameList(assigneeIds)}` : "ไม่เหลือผู้รับผิดชอบ";
        const newlyAdded = assigneeIds.filter((id) => !t.assigneeIds.includes(id));
        const removed = t.assigneeIds.filter((id) => !assigneeIds.includes(id));
        // แยกบรรทัด "เอาออก" กับ "เพิ่ม" — เดิมบันทึกแค่รายชื่อหลังเปลี่ยน ("เป็น A, B") อ่านแล้ว
        // ไม่รู้ว่าใครถูกเอาออก ต้องเทียบกับบรรทัดก่อนหน้าเอง · คนที่กดคือ userId ของบรรทัดนั้น
        if (removed.length > 0) {
          logActivity(actorId, "เอาผู้รับผิดชอบออก", t.title, t.id, `${nameList(removed)} · ${remaining}`);
        }
        if (newlyAdded.length > 0) {
          logActivity(actorId, "เพิ่มผู้รับผิดชอบ", t.title, t.id, `${nameList(newlyAdded)} · รวมเป็น ${nameList(assigneeIds)}`);
        }
        // แจ้งเฉพาะคนที่เพิ่ง "เพิ่มเข้ามาใหม่" ไม่ใช่ทั้งลิสต์ — คนที่รับผิดชอบ
        // อยู่แล้วไม่ต้องเตือนซ้ำแค่เพราะมีคนอื่นถูกเพิ่ม/เอาออก เหมือนตอนสร้าง
        // งานใหม่ (addTask) ที่เพิ่งเพิ่มแจ้งเตือนไปด้วยกัน
        if (newlyAdded.length > 0) {
          const actorName = getUser(actorId)?.name ?? "หัวหน้า";
          useNotificationStore
            .getState()
            .notifyMany(
              newlyAdded,
              actorId,
              `${actorName} มอบหมายงาน "${t.title}" ให้คุณ`,
              undefined,
              `/report-task/tasks?task=${t.id}`,
              undefined,
              "task_assigned",
              t.id
            );
        }
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
  addComment: (taskId, message, authorId, attachments, mentionIds) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId) return t;
        // Everyone already part of this task's conversation — the
        // assignee(s), whoever assigned it, and anyone who's commented
        // before — same "someone replied" spirit as report_task's own
        // comment notifications. notifyMany skips the author themselves.
        const mentioned = new Set((mentionIds ?? []).filter((id) => id !== authorId));
        const recipients = Array.from(new Set([...t.assigneeIds, t.assignedById, ...t.comments.map((c) => c.authorId)])).filter(
          (id) => !mentioned.has(id)
        );
        const actorName = getUser(authorId)?.name ?? "มีคน";
        // ส่งสติกเกอร์/ไฟล์อย่างเดียว ไม่มีข้อความ — บอกว่าส่งอะไรมา แทนแจ้งเตือนเปล่า ๆ
        const preview = message
          ? message.length > 60
            ? `${message.slice(0, 60)}…`
            : message
          : attachments?.some((a) => a.sticker)
            ? "ส่งสติกเกอร์"
            : // รูป/ไฟล์อย่างเดียว — บอกจำนวน · หลายคอมเมนต์ติดกันรวมเป็นแจ้งเตือนเดียวที่เซิร์ฟเวอร์ (attachment-notif-group.ts)
              (() => {
                const n = attachments?.length ?? 0;
                const photos = n > 0 && attachments!.every((a) => a.type === "รูปภาพ");
                return photos ? (n > 1 ? `ส่งรูป ${n} รูป` : "ส่งรูป") : n > 1 ? `แนบไฟล์ ${n} ไฟล์` : "แนบไฟล์";
              })();
        // สร้าง id ก่อน — ลิงก์แจ้งเตือนชี้ตรงคอมเมนต์นี้ (?task=&comment=) หน้าต่างงานเลื่อนไปหา + กะพริบ
        const commentId = `${taskId}-cmt-${uuid()}`;
        const commentLink = `/report-task/tasks?task=${t.id}&comment=${encodeURIComponent(commentId)}`;
        // งานส่วนตัว: คนที่ถูกแท็กเปิดงานนี้ไม่ได้ ไม่แจ้ง (ชื่องานห้ามหลุด — personal-task.ts)
        if (mentioned.size > 0 && !isPersonalTask(t)) {
          useNotificationStore
            .getState()
            .notifyMany(
              [...mentioned],
              authorId,
              `${actorName} แท็กคุณในงาน "${t.title}": ${preview}`,
              undefined,
              commentLink,
              undefined,
              "task_comment",
              t.id
            );
        }
        useNotificationStore
          .getState()
          .notifyMany(
            recipients,
            authorId,
            `${actorName} แสดงความคิดเห็นในงาน "${t.title}": ${preview}`,
            undefined,
            commentLink,
            undefined,
            "task_comment",
            t.id
          );
        return {
          ...t,
          comments: [
            ...t.comments,
            {
              id: commentId,
              authorId,
              message,
              createdAt: new Date().toISOString(),
              ...(attachments && attachments.length > 0 ? { attachments } : {}),
            },
          ],
        };
      }),
    })),
  removeComment: (taskId, commentId) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id !== taskId ? t : { ...t, comments: t.comments.filter((c) => c.id !== commentId) }
      ),
    })),
  addAttachments: (taskId, attachments) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId || attachments.length === 0) return t;
        // แจ้งคนกลุ่มเดียวกับตอนมีคอมเมนต์ใหม่ (ดู addComment ข้างบน) — ไฟล์แนบ
        // ใหม่ที่ยังไม่มีใครเห็นก็ควรมีจุดแดงบนการ์ดเหมือนกัน ไม่ใช่แค่คอมเมนต์
        // ชุดเดียวกัน = แจ้งครั้งเดียว (เดิมเด้งทีละไฟล์ รัวจนน่ารำคาญ)
        const recipients = Array.from(new Set([...t.assigneeIds, t.assignedById, ...t.comments.map((c) => c.authorId)]));
        const first = attachments[0]!;
        const actorName = getUser(first.uploadedBy)?.name ?? "มีคน";
        useNotificationStore
          .getState()
          .notifyMany(
            recipients,
            first.uploadedBy,
            attachments.length === 1
              ? `${actorName} แนบไฟล์ "${first.name}" ในงาน "${t.title}"`
              : `${actorName} แนบไฟล์ ${attachments.length} ไฟล์ ในงาน "${t.title}"`,
            undefined,
            `/report-task/tasks?task=${t.id}`,
            undefined,
            "task_attachment",
            t.id
          );
        return { ...t, attachments: [...t.attachments, ...attachments] };
      }),
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
          const item = t.checklist.find((c) => c.id === itemId);
          const nextChecklist = t.checklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c));
          const updated = applyChecklistDerivedCompletion(t, nextChecklist, actorId);
          // Checking one item off is worth a quick nod to whoever opened the
          // task — they shouldn't have to keep the board open just to see
          // incremental progress. Only the moment it flips to done (not
          // un-ticking), and never when the task's own creator is the one
          // ticking their own item.
          if (item && !item.done && t.assignedById !== actorId) {
            const actorName = getUser(actorId)?.name ?? "มีคน";
            useNotificationStore.getState().notify({
              userId: t.assignedById,
              byUserId: actorId,
              message: `${actorName} ทำ "${item.text}" ในเช็คลิสต์ของ "${t.title}" เสร็จแล้ว`,
              link: `/report-task/tasks?task=${t.id}`,
            });
          }
          return updated;
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
        if (mine.length === 0) {
          // No items of their own to tick (a group task where only others got
          // checklist items) — flip their part done/undone by hand instead.
          if (!t.assigneeIds.includes(userId) || t.checklist.length === 0) return t;
          const prev = t.completedAssigneeIds ?? [];
          const manual = prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId];
          return applyChecklistDerivedCompletion(t, t.checklist, userId, manual);
        }
        const allMineDone = mine.every((c) => c.done);
        const nextChecklist = t.checklist.map((c) => (c.ownerId === userId ? { ...c, done: !allMineDone } : c));
        return applyChecklistDerivedCompletion(t, nextChecklist, userId);
      }),
    })),
  addReaction: (taskId, stickerId, byUserId, note, targetUserId) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (t) {
        const sticker = useStickerStore.getState().stickers.find((st) => st.id === stickerId);
        const label = sticker?.label ?? stickerId;
        logActivity(byUserId, "ติดสติกเกอร์", t.title, t.id, label);
        // "อีโมจิพวกนี้มีการแจ้งเตือนใช่ไหม" — ก่อนหน้านี้แค่บันทึก activity
        // log ไม่เคยแจ้งเจ้าของงานเลย แจ้งเฉพาะ assignee (ไม่รวมหัวหน้าแผนก
        // เหมือน notifyPenaltyChange — สติกเกอร์แค่ชม/หัก ไม่ใช่เรื่องใหญ่
        // ระดับต้องให้หัวหน้ารับรู้ด้วย)
        const actorName = getUser(byUserId)?.name ?? "มีคน";
        const pts = sticker?.points ?? 0;
        useNotificationStore
          .getState()
          .notifyMany(
            reactionRecipients(t.assigneeIds, targetUserId),
            byUserId,
            `${actorName} ติดสติกเกอร์ "${sticker?.emoji ?? "🏷️"} ${label}" ให้งาน "${t.title}"${targetUserId ? " (เฉพาะคุณ)" : t.taskMode === "group" ? " (ทั้งกลุ่ม)" : ""}${pts !== 0 ? ` (${pts > 0 ? `+${pts}` : pts} คะแนน)` : ""}`,
            undefined,
            `/report-task/tasks?task=${t.id}`
          );
      }
      return {
        tasks: s.tasks.map((x) =>
          x.id !== taskId
            ? x
            : {
                ...x,
                reactions: [
                  ...x.reactions,
                  {
                    id: `${taskId}-rxn-${uuid()}`,
                    stickerId,
                    byUserId,
                    note,
                    ...(targetUserId ? { targetUserId } : {}),
                    createdAt: new Date().toISOString(),
                  },
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
  toggleEmojiReaction: (taskId, emoji, userId) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      // แจ้งเฉพาะตอน "ติด" ไม่ใช่ตอนกดซ้ำเพื่อเอาออก — กันสแปมแจ้งเตือนจาก
      // การกดเข้า-ออกซ้ำๆ ("อีโมจิพวกนี้มีการแจ้งเตือนใช่ไหม")
      if (t && !(t.emojiReactions?.[emoji] ?? []).includes(userId)) {
        const actorName = getUser(userId)?.name ?? "มีคน";
        useNotificationStore.getState().notifyMany(t.assigneeIds, userId, `${actorName} ส่ง ${emoji} ให้งาน "${t.title}"`, undefined, `/report-task/tasks?task=${t.id}`);
      }
      return {
        tasks: s.tasks.map((x) => {
          if (x.id !== taskId) return x;
          const current = x.emojiReactions?.[emoji] ?? [];
          const next = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
          return { ...x, emojiReactions: { ...x.emojiReactions, [emoji]: next } };
        }),
      };
    }),
  toggleWatcher: (taskId, userId) =>
    set((s) => {
      const t = s.tasks.find((x) => x.id === taskId);
      if (t) {
        const watching = !(t.watcherIds ?? []).includes(userId);
        logActivity(userId, watching ? "ติดตามงาน" : "เลิกติดตามงาน", t.title, t.id);
      }
      return {
        tasks: s.tasks.map((x) => {
          if (x.id !== taskId) return x;
          const current = x.watcherIds ?? [];
          const next = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
          return { ...x, watcherIds: next };
        }),
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
                    id: `${taskId}-cmt-${uuid()}`,
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
