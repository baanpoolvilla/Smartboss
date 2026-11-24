import type { Task } from "@/modules/report_task/types";
import type { MaintenanceBoardItem } from "@/modules/report_task/lib/maintenance-board";

/**
 * คะแนนที่โดนหักอยู่จริง (ไม่นับที่ยกเว้น/คืนแล้ว) — ใช้แสดงป้าย "−N" ให้งาน งานโปรเจกต์ และใบงานซ่อม
 * เหมือนกันทุกมุมมองของหน้างาน (บอร์ด/ตาราง/ภาระงาน — ผู้ใช้ 24/11/2569 "ให้มาแสดงให้ครบเหมือนกัน")
 *
 * งาน: งานเดี่ยวใช้ penalty · งานกลุ่มใช้ penalties รายคน — ระบุ userId = เฉพาะส่วนของคนนั้น
 */
export function taskDockedPoints(task: Pick<Task, "penalty" | "penalties" | "assigneeIds">, userId?: string): number {
  const pts = (p: { points: number; waived?: unknown } | null | undefined) => (p && !p.waived ? Math.abs(p.points) : 0);
  const group = task.penalties ?? {};
  if (Object.keys(group).length > 0) {
    return userId ? pts(group[userId]) : Object.values(group).reduce((sum, p) => sum + pts(p), 0);
  }
  if (userId && !task.assigneeIds.includes(userId)) return 0;
  return pts(task.penalty);
}

/** ใบงานซ่อม: ป้ายคะแนนของใบ (score) เฉพาะที่ยังหักอยู่ — คืนแล้ว/ยกเว้น = 0 */
export function workOrderDockedPoints(item: Pick<MaintenanceBoardItem, "score">): number {
  return item.score?.kind === "docked" ? Math.abs(item.score.points) : 0;
}
