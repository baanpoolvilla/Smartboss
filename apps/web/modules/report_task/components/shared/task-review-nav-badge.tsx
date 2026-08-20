"use client";

import { useMemo } from "react";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canEditRecord } from "@/modules/report_task/lib/permissions";

/**
 * Discord-style unread pill for the "งาน / Kanban" rail item (see
 * module-registry.ts's `ModuleMenuItem.badge` and shell.tsx's RailItem) —
 * counts tasks sitting in "เสร็จสิ้น" with nobody's sign-off yet
 * (`!task.reviewedBy`, same condition task-detail-sheet.tsx's "รอเช็ค" chip
 * uses), scoped to whoever can actually clear it: the owner, whoever
 * assigned the task, or that task's department head — the same
 * `canEditRecord` circle the "ผ่าน"/"ไม่ผ่าน" buttons themselves are gated
 * behind, so this never nags someone who has no "ผ่าน" button to press.
 * Renders nothing at zero — an always-present empty pill would just be
 * visual noise on every other module's page too.
 */
export function TaskReviewNavBadge() {
  const tasks = useTaskStore((s) => s.tasks);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);

  const count = useMemo(
    () =>
      tasks.filter(
        (t) => t.status === "done" && !t.reviewedBy && canEditRecord(t.assignedById, t.departmentIds, viewingAsUserId)
      ).length,
    [tasks, viewingAsUserId]
  );

  if (count === 0) return null;
  return (
    <span
      className="ml-auto flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white"
      aria-label={`มีงานรอตรวจ ${count} รายการ`}
      title={`มีงานรอตรวจ ${count} รายการ`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
