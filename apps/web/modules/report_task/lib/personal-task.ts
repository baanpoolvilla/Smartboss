import type { Task } from "@/modules/report_task/types";

/**
 * งานส่วนตัว = งานที่คนสร้างเป็นผู้รับงานคนเดียว (เปิดให้ตัวเอง)
 *
 * ใช้เตือนตัวเองว่าวันนั้นมีอะไรต้องทำ ไม่ใช่งานที่ถูกมอบหมาย จึง:
 *   - เห็นเฉพาะเจ้าของ — CEO/หัวหน้าแผนกก็ไม่เห็น (กรองตั้งแต่ GET /api/report-task/tasks)
 *   - ไม่มีผลกับคะแนนใด ๆ — ไม่หักเลยกำหนด (task-penalty-sweep) สติกเกอร์ไม่ลงคะแนน (task-repo)
 *   - ไม่นับในสรุปภาพรวมของบริษัท (ai-insight)
 * เพิ่มผู้รับงานคนอื่นเมื่อไหร่ = งานปกติทันที (เห็นตามสิทธิ์ นับคะแนนตามปกติ)
 */
export function isPersonalTask(task: Pick<Task, "assignedById" | "assigneeIds">): boolean {
  return !!task.assignedById && task.assigneeIds.length === 1 && task.assigneeIds[0] === task.assignedById;
}

/** งานส่วนตัวของคนอื่น = มองไม่เห็น · งานอื่น ๆ ไม่ตัดสินที่นี่ (ใช้กติกาสิทธิ์ปกติ) */
export function isOthersPersonalTask(task: Pick<Task, "assignedById" | "assigneeIds">, userId: string): boolean {
  return isPersonalTask(task) && task.assignedById !== userId;
}
