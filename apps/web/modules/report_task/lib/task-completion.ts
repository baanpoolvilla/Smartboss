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
