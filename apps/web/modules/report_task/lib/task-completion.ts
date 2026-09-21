import type { ChecklistItem } from "@/modules/report_task/types";

/**
 * An assignee's part is done once every checklist item they own is checked.
 * An individual task is just a group of one under this rule — every item's
 * `ownerId` is the sole assignee, so it collapses to "checklist fully done".
 * An assignee with zero owned items never counts as done here — this is the
 * *automatic* completion path driven by ticking boxes. A task with no checklist
 * at all (checklists are optional at creation) is finished by hand instead;
 * see isTaskFullyDone.
 */
/** งานกลุ่มปิดเมื่อ: "all" = ทุกคนทำส่วนของตัวเองครบ (ค่าเดิม), "any" = คนใดคนหนึ่งครบก็ปิดงานได้ */
export type CompletionRule = "all" | "any";

/** ตามกติกา rule แล้วงานนี้ถือว่าครบหรือยัง เมื่อรู้แล้วว่าใครทำส่วนตัวเองครบบ้าง */
export function isDoneByRule(assigneeIds: string[], completedIds: string[], rule: CompletionRule = "all"): boolean {
  if (assigneeIds.length === 0) return false;
  return rule === "any" ? assigneeIds.some((id) => completedIds.includes(id)) : assigneeIds.every((id) => completedIds.includes(id));
}

export function deriveCompletedAssigneeIds(assigneeIds: string[], checklist: ChecklistItem[]): string[] {
  return assigneeIds.filter((id) => {
    const mine = checklist.filter((c) => c.ownerId === id);
    return mine.length > 0 && mine.every((c) => c.done);
  });
}

/**
 * Whether a task is allowed to reach "เสร็จสิ้น" — every assignee's own
 * checklist items checked, same rule as deriveCompletedAssigneeIds, checked
 * in aggregate. Used to block the shortcuts that skip straight to a status
 * change (drag-and-drop, the status dropdown, the quick-toggle circle, bulk
 * status actions) — without this, those could mark a task done with an
 * incomplete checklist, out of step with the automatic completion path.
 */
export function isTaskFullyDone(assigneeIds: string[], checklist: ChecklistItem[], rule: CompletionRule = "all"): boolean {
  if (assigneeIds.length === 0) return false;
  // งานที่ไม่มีเช็คลิสต์เลย (เช็คลิสต์ไม่บังคับแล้ว) ไม่มีอะไรให้ติ๊กเป็นเงื่อนไข — เลื่อนเป็น "เสร็จสิ้น" เองได้
  if (checklist.length === 0) return true;
  return isDoneByRule(assigneeIds, deriveCompletedAssigneeIds(assigneeIds, checklist), rule);
}

/** How many checklist items are still unchecked across every assignee — for
 * the "ยังติ๊กไม่ครบ N ข้อ" toast when a status-change shortcut is blocked. */
export function remainingChecklistCount(checklist: ChecklistItem[]): number {
  return checklist.filter((c) => !c.done).length;
}
