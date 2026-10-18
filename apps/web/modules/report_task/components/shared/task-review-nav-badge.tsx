"use client";

import { useMemo } from "react";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useNotificationStore, type AppNotification } from "@/modules/report_task/store/notification-store";
import type { Task } from "@/modules/report_task/types";
import { canReviewTask } from "@/modules/report_task/lib/permissions";
import { useTaskReviewSettingsStore } from "@/modules/report_task/store/task-review-settings-store";
import { unreadTaskAssignmentCounts, unreadTaskAttachmentCounts, unreadTaskCommentCounts } from "@/modules/report_task/lib/task-comment-activity";

type ReviewSettings = ReturnType<typeof useTaskReviewSettingsStore.getState>["settings"];

/** taskId ของงานที่อยู่ในโปรเจกต์ */
export function projectTaskIds(tasks: Task[]): Set<string> {
  return new Set(tasks.filter((t) => t.project).map((t) => t.id));
}

/** รอตรวจ (ที่เรามีสิทธิ์ตรวจ) + คอมเมนต์/ไฟล์แนบ/การมอบหมายที่ยังไม่อ่าน — เฉพาะงานที่ include(taskId) ผ่าน */
export function taskNavBadgeCount(
  tasks: Task[],
  notifications: AppNotification[],
  userId: string,
  reviewSettings: ReviewSettings,
  include: (taskId: string) => boolean
): number {
  const reviewCount = tasks.filter(
    (t) => include(t.id) && t.status === "done" && !t.reviewedBy && canReviewTask(t.departmentIds, userId, reviewSettings)
  ).length;
  let unreadActivityCount = 0;
  for (const counts of [
    unreadTaskCommentCounts(notifications, userId),
    unreadTaskAttachmentCounts(notifications, userId),
    unreadTaskAssignmentCounts(notifications, userId),
  ]) {
    for (const [taskId, n] of counts) if (include(taskId)) unreadActivityCount += n;
  }
  return reviewCount + unreadActivityCount;
}

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

  // งานโปรเจกต์ไม่ขึ้นบนบอร์ดแล้ว — นับไว้ที่เมนู "โปรเจกต์" แทน (ProjectNavBadge)
  const count = useMemo(() => {
    const ids = projectTaskIds(tasks);
    return taskNavBadgeCount(tasks, notifications, viewingAsUserId, reviewSettings, (id) => !ids.has(id));
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
