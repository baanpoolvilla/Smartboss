"use client";

import { useMemo } from "react";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useTaskReviewSettingsStore } from "@/modules/report_task/store/task-review-settings-store";
import { projectTaskIds, taskNavBadgeCount } from "./task-review-nav-badge";

/**
 * จุดแดงที่เมนู "โปรเจกต์" — สูตรเดียวกับ TaskReviewNavBadge (รอตรวจที่เราเป็นคน
 * ตรวจ/หัวหน้า + คอมเมนต์/ไฟล์แนบ/การมอบหมายที่ยังไม่อ่าน) แต่นับเฉพาะงานที่อยู่ใน
 * โปรเจกต์ เพราะงานโปรเจกต์ไม่ขึ้นบนบอร์ด Kanban แล้ว ("ถ้ามีอะไรเกี่ยวกับเราใน
 * โปรเจกหรือหัวหน้าอะไรให้แจ้งเตือนแบบของ task ด้วย")
 */
export function ProjectNavBadge() {
  const tasks = useTaskStore((s) => s.tasks);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const reviewSettings = useTaskReviewSettingsStore((s) => s.settings);
  const notifications = useNotificationStore((s) => s.notifications);

  const count = useMemo(() => {
    const ids = projectTaskIds(tasks);
    return taskNavBadgeCount(tasks, notifications, viewingAsUserId, reviewSettings, (id) => ids.has(id));
  }, [tasks, viewingAsUserId, reviewSettings, notifications]);

  if (count === 0) return null;
  return (
    <span
      className="ml-auto flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white"
      aria-label={`มีเรื่องในโปรเจกต์รอคุณ ${count} รายการ`}
      title={`มีเรื่องในโปรเจกต์รอคุณ ${count} รายการ`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
