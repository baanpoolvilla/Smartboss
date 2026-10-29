import type { Task } from "@/modules/report_task/types";
import { canEditRecord } from "@/modules/report_task/lib/permissions";

/** คำขอเลื่อนกำหนดส่งที่ยังรออนุมัติ — ใช้ขึ้นป้ายบนการ์ด/หัวคอลัมน์ (ผู้ใช้ 29/10/2569 "ดูไม่ออกเลยว่ามีการรออนุมัติ") */
export const pendingDueRequestsOf = (task: Task) => (task.dueDateRequests ?? []).filter((r) => r.status === "pending");

/** คนนี้ต้องกดอนุมัติไหม — กติกาเดียวกับปุ่มในหน้างาน (canEditMain และไม่ใช่คำขอของตัวเอง) */
export const dueRequestWaitsFor = (task: Task, userId: string) =>
  canEditRecord(task.assignedById, task.departmentIds, userId) && pendingDueRequestsOf(task).some((r) => r.requestedBy !== userId);
