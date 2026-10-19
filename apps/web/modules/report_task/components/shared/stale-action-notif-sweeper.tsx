"use client";

import { useEffect } from "react";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { isWithdrawnDueRequestNotification } from "@/modules/report_task/lib/withdrawn-due-request-notif";

/**
 * แจ้งเตือนงาน "รอคุณทำ" ที่คนอื่นจัดการไปแล้ว ⇒ ถือว่าอ่านแล้ว (ของเราเอง) ไม่ค้างเป็นเลขแดง
 * (ผู้ใช้ขอ 18/10/2569 "ถ้าอะไรถูกเคลียแล้วก็ต้องไม่เห็น · เฉพาะอันที่คนอื่นทำไปแล้ว
 * ถ้ายังไม่ได้ทำแค่คนอื่นกดอ่านก็ยังเห็นอยู่") — ดูจากสถานะงานจริง ไม่ใช่จากว่าใครอ่าน:
 *   - "ขอเลื่อนกำหนดส่ง" ที่ส่งถึงผู้อนุมัติ: คำขอของคนนั้นไม่ค้าง (อนุมัติ/ไม่อนุมัติ/ยกเลิกไปแล้ว)
 *   - "มอบหมายให้คุณ": เราไม่ได้เป็นผู้รับผิดชอบงานนั้นแล้ว (ย้ายไปให้คนอื่น)
 * คอมเมนต์/ไฟล์แนบใหม่ไม่แตะ — เป็นข่าวสาร ต้องเห็นจนกว่าเราจะเปิดดูเอง
 * งานที่ยังไม่โหลด/หาไม่เจอ ข้าม (ไม่เดา) · เขียนแค่แจ้งเตือนของตัวเอง (markRead) เหมือนตอนเปิดงาน
 */
export function StaleActionNotifSweeper() {
  const tasks = useTaskStore((s) => s.tasks);
  const tasksLoaded = useTaskStore((s) => s.loaded);
  const notifications = useNotificationStore((s) => s.notifications);
  const notifLoaded = useNotificationStore((s) => !!s.loaded);
  const markRead = useNotificationStore((s) => s.markRead);
  const me = useIdentityStore((s) => s.viewingAsUserId);

  useEffect(() => {
    if (!tasksLoaded || !notifLoaded) return;
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const stale: string[] = [];
    for (const n of notifications) {
      if (n.userId !== me || n.read || !n.taskId) continue;
      const t = byId.get(n.taskId);
      if (!t) continue;
      if (n.kind === "task_assigned" && !t.assigneeIds.includes(me)) stale.push(n.id);
      else if (
        n.kind === "task_due_request" &&
        n.message.includes("ขอเลื่อนกำหนดส่งงาน") &&
        (!(t.dueDateRequests ?? []).some((r) => r.status === "pending" && r.requestedBy === n.byUserId) ||
          // ขอใหม่แทนคำขอเดิม — อันเก่าไม่ค้างเป็นเลขแดงคู่กับอันใหม่
          isWithdrawnDueRequestNotification(n, t.dueDateRequests))
      )
        stale.push(n.id);
    }
    for (const id of stale) markRead(id);
  }, [tasks, tasksLoaded, notifications, notifLoaded, me, markRead]);

  return null;
}
