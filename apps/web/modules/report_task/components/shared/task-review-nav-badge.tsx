"use client";

import { useMemo } from "react";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { canReviewTask } from "@/modules/report_task/lib/permissions";
import { useTaskReviewSettingsStore } from "@/modules/report_task/store/task-review-settings-store";
import { unreadTaskAssignmentCounts, unreadTaskAttachmentCounts, unreadTaskCommentCounts } from "@/modules/report_task/lib/task-comment-activity";

/**
 * Discord-style unread pill for the "งาน / Kanban" rail item (see
 * module-registry.ts's `ModuleMenuItem.badge` and shell.tsx's RailItem) —
 * sums two things:
 *   - tasks sitting in "เสร็จสิ้น" with nobody's sign-off yet
 *     (`!task.reviewedBy`, same condition task-detail-sheet.tsx's "รอตรวจสอบ"
 *     chip uses), scoped to whoever can actually clear it: the owner or that
 *     task's department head — the same `canReviewTask` circle the "ผ่าน"/
 *     "ไม่ผ่าน" buttons themselves are gated behind (deliberately narrower
 *     than canEditRecord: a plain assigner who isn't also a head can edit the
 *     task but doesn't get to review their own assignment), so this never
 *     nags someone who has no "ผ่าน" button to press.
 *   - unread comments/attachments/assignments on tasks (see
 *     task-comment-activity.ts) — someone replied, attached a file, or
 *     assigned the viewer to a task, and they haven't opened it since, same
 *     rule the per-card badges on the Kanban board itself use.
 * Renders nothing at zero — an always-present empty pill would just be
 * visual noise on every other module's page too.
 */
export function TaskReviewNavBadge() {
  const tasks = useTaskStore((s) => s.tasks);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const reviewSettings = useTaskReviewSettingsStore((s) => s.settings);
  const notifications = useNotificationStore((s) => s.notifications);

  const count = useMemo(() => {
    const reviewCount = tasks.filter(
      (t) => t.status === "done" && !t.reviewedBy && canReviewTask(t.departmentIds, viewingAsUserId, reviewSettings)
    ).length;
    const unreadComments = unreadTaskCommentCounts(notifications, viewingAsUserId);
    const unreadAttachments = unreadTaskAttachmentCounts(notifications, viewingAsUserId);
    const unreadAssignments = unreadTaskAssignmentCounts(notifications, viewingAsUserId);
    let unreadActivityCount = 0;
    for (const n of unreadComments.values()) unreadActivityCount += n;
    for (const n of unreadAttachments.values()) unreadActivityCount += n;
    for (const n of unreadAssignments.values()) unreadActivityCount += n;
    return reviewCount + unreadActivityCount;
  }, [tasks, viewingAsUserId, reviewSettings, notifications]);

  if (count === 0) return null;
  return (
    <span
      className="ml-auto flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white"
      aria-label={`มีงานรอตรวจ/งานที่ได้รับมอบหมาย/คอมเมนต์หรือไฟล์แนบใหม่ ${count} รายการ`}
      title={`มีงานรอตรวจ/งานที่ได้รับมอบหมาย/คอมเมนต์หรือไฟล์แนบใหม่ ${count} รายการ`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
