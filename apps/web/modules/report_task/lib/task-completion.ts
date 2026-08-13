import type { ChecklistItem } from "@/modules/report_task/types";

/**
 * An assignee's part is done once every checklist item they own is checked.
 * An individual task is just a group of one under this rule — every item's
 * `ownerId` is the sole assignee, so it collapses to "checklist fully done".
 * An assignee with zero owned items never counts as done (checklists are
 * mandatory at creation, so this only matters for pre-migration data).
 */
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
export function isTaskFullyDone(assigneeIds: string[], checklist: ChecklistItem[]): boolean {
  return assigneeIds.length > 0 && deriveCompletedAssigneeIds(assigneeIds, checklist).length === assigneeIds.length;
}

/** How many checklist items are still unchecked across every assignee — for
 * the "ยังติ๊กไม่ครบ N ข้อ" toast when a status-change shortcut is blocked. */
export function remainingChecklistCount(checklist: ChecklistItem[]): number {
  return checklist.filter((c) => !c.done).length;
}
