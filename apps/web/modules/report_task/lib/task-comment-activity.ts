import type { AppNotification } from "@/modules/report_task/store/notification-store";

/** นับ unread ของ "ฉัน" แยกต่อ taskId ตาม kind ที่ระบุ — ใช้เป็นฐานให้
 * unreadTaskCommentCounts/unreadTaskAttachmentCounts ด้านล่าง ไม่ต้องเขียน
 * ลูปกรองซ้ำสองรอบ */
function unreadTaskCountsByKind(
  notifications: AppNotification[],
  userId: string,
  kind: "task_comment" | "task_attachment" | "task_assigned"
): Map<string, number> {
  const map = new Map<string, number>();
  for (const n of notifications) {
    if (n.userId !== userId || n.read || n.kind !== kind || !n.taskId) continue;
    map.set(n.taskId, (map.get(n.taskId) ?? 0) + 1);
  }
  return map;
}

/** จำนวนคอมเมนต์ที่ยังไม่อ่านของ "ฉัน" แยกต่อ taskId — ใช้ทั้งกับ badge บน
 * การ์ด Kanban รายใบ (task-card.tsx) และผลรวมทั้งหมดบนเมนู/ไอคอนโมดูล
 * (task-review-nav-badge.tsx, app-tile-review-badge.tsx) ให้สามที่นี้นับตรงกัน
 * เสมอ ไม่ใช่สูตรใครสูตรมัน */
export function unreadTaskCommentCounts(notifications: AppNotification[], userId: string): Map<string, number> {
  return unreadTaskCountsByKind(notifications, userId, "task_comment");
}

/** เหมือน unreadTaskCommentCounts แต่นับไฟล์แนบใหม่ที่ยังไม่ได้เห็นแทน — คนละ
 * ไอคอนกัน (📎 ไม่ใช่ 💬) บนการ์ด แต่ mark-as-read ตอนเปิดงานร่วมจุดเดียวกัน
 * (ดู notification-store.ts's markTaskActivityRead) */
export function unreadTaskAttachmentCounts(notifications: AppNotification[], userId: string): Map<string, number> {
  return unreadTaskCountsByKind(notifications, userId, "task_attachment");
}

/** เหมือน unreadTaskCommentCounts แต่นับ "มีคนมอบหมาย/เพิ่มคุณเป็นผู้รับผิดชอบ
 * งานนี้" ที่ยังไม่ได้เปิดดูแทน — เดิมงานที่เพิ่งได้รับมอบหมายไม่ขึ้น badge ที่
 * เมนู "งาน / Kanban" หรือไอคอนหน้าแรกเลย เห็นแค่ในกระดิ่งอย่างเดียว
 * ("เวลามีคนมอบหมายงานมาทำไมตรงที่วงไม่ขึ้นแดง") mark-as-read ตอนเปิดงาน
 * ร่วมจุดเดียวกับสองอันบน (ดู notification-store.ts's markTaskActivityRead) */
export function unreadTaskAssignmentCounts(notifications: AppNotification[], userId: string): Map<string, number> {
  return unreadTaskCountsByKind(notifications, userId, "task_assigned");
}
