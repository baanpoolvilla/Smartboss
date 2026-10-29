import type { Task } from "@/modules/report_task/types";
import { isOwner } from "@/modules/report_task/lib/directory";

/** คำขอเลื่อนกำหนดส่งที่ยังรออนุมัติ — ใช้ขึ้นป้ายบนการ์ด/หัวคอลัมน์ (ผู้ใช้ 29/10/2569 "ดูไม่ออกเลยว่ามีการรออนุมัติ") */
export const pendingDueRequestsOf = (task: Task) => (task.dueDateRequests ?? []).filter((r) => r.status === "pending");

/**
 * ใครอนุมัติคำขอเลื่อนกำหนดส่งงานได้ — คนสร้าง/มอบหมายงาน หรือ CEO (เจ้าของบริษัท) · ไม่ใช้หัวหน้าแผนกแล้ว
 * (ผู้ใช้ 29/10/2569 "ให้คนสร้างงานเลื่อนได้และ ceo" — ตรงกับใบงานซ่อม maintenance/lib/due-request-access.ts)
 * คนขอเองอนุมัติของตัวเองไม่ได้ — ผู้เรียกเช็ค requestedBy เอง
 */
export const canDecideTaskDueRequest = (task: Pick<Task, "assignedById">, userId: string) =>
  isOwner(userId) || (!!task.assignedById && task.assignedById === userId);

/**
 * การ์ดแดง "รอคุณอนุมัติ" — เฉพาะคนมอบหมายงาน (เรื่องของตัวเอง) · CEO อนุมัติงานคนอื่นได้ แต่เห็นเป็นป้ายเล็กแทน
 * ไม่งั้นการ์ดแดงทุกใบที่มีคนขอเลื่อน (ผู้ใช้ 29/10/2569 "เอาแค่เกี่ยวกับตัวเองพอ")
 */
export const dueRequestWaitsFor = (task: Task, userId: string) =>
  !!task.assignedById && task.assignedById === userId && pendingDueRequestsOf(task).some((r) => r.requestedBy !== userId);
