import type { Task } from "@/modules/report_task/types";

/**
 * งานส่วนตัว = งานที่คนสร้างเป็นผู้รับงานคนเดียว (เปิดให้ตัวเอง)
 *
 * ใช้เตือนตัวเองว่าวันนั้นมีอะไรต้องทำ ไม่ใช่งานที่ถูกมอบหมาย จึง:
 *   - เห็นเฉพาะเจ้าของ — CEO/หัวหน้าแผนกก็ไม่เห็น (กรองตั้งแต่ GET /api/report-task/tasks)
 *   - ไม่มีผลกับคะแนนใด ๆ — ไม่หักเลยกำหนด (task-penalty-sweep) สติกเกอร์ไม่ลงคะแนน (task-repo)
 *   - ไม่นับในสรุปภาพรวมของบริษัท (ai-insight)
 * เพิ่มผู้รับงานคนอื่นเมื่อไหร่ = งานปกติทันที (เห็นตามสิทธิ์ นับคะแนนตามปกติ)
 *
 * งานส่วนตัวแบบกลุ่ม (personalGroup · ผู้ใช้ 10/11/2569 "งานส่วนตัวทำเป็นกลุ่มได้ คนสร้างต้องทำด้วย แจ้งเตือนด้วย")
 *   ติ๊กไว้ตอนสร้าง — กติกาเดียวกับงานส่วนตัวทุกข้อ แต่ "เจ้าของ" คือทุกคนในงาน (เห็น/แจ้งเตือนกันเองได้)
 *   คนนอกงาน รวม CEO/หัวหน้า ไม่เห็น ไม่ได้แจ้งเตือน
 */
export function isPersonalTask(task: Pick<Task, "assignedById" | "assigneeIds"> & { project?: Task["project"]; personalGroup?: boolean }): boolean {
  // งานในโปรเจกต์ไม่ใช่งานส่วนตัว แม้คนสร้างจะมอบให้ตัวเอง (เช่น ตำแหน่งในแม่แบบที่ตกเป็นของเจ้าของ)
  // — สมาชิกโปรเจกต์ต้องเห็นกันบนแผนเวลา/รายการ และนับคะแนนตามปกติ
  if (task.project) return false;
  if (task.personalGroup) return !!task.assignedById;
  return !!task.assignedById && task.assigneeIds.length === 1 && task.assigneeIds[0] === task.assignedById;
}

/** งานส่วนตัวของคนอื่น = มองไม่เห็น · งานอื่น ๆ ไม่ตัดสินที่นี่ (ใช้กติกาสิทธิ์ปกติ) */
export function isOthersPersonalTask(task: Pick<Task, "assignedById" | "assigneeIds"> & { project?: Task["project"]; personalGroup?: boolean }, userId: string): boolean {
  return isPersonalTask(task) && task.assignedById !== userId && !task.assigneeIds.includes(userId);
}

/**
 * งานเสร็จแล้วแต่ยังรอคนตรวจ (คอลัมน์ "รอตรวจสอบ") — งานส่วนตัวไม่มีใครต้องตรวจ เสร็จ = เสร็จสิ้นเลย
 * (ผู้ใช้ 5/11/2569 "งานส่วนตัว...ต้องกดแล้วเสร็จเลยไหม เพราะไม่ต้องให้ใครตรวจ") · ไม่แตะข้อมูล งานเก่าที่ค้างก็หายเอง
 */
export function isAwaitingReview(
  task: Pick<Task, "status" | "reviewedBy" | "assignedById" | "assigneeIds"> & { project?: Task["project"] },
): boolean {
  return task.status === "done" && !task.reviewedBy && !isPersonalTask(task);
}
