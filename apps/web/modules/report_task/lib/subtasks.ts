import { departmentIdsOf } from "@/modules/report_task/lib/directory";
import type { Task } from "@/modules/report_task/types";

/**
 * งานย่อย (แบบ Asana Subtasks) — เป็น Task ปกติทุกอย่าง แค่มี parentId ชี้งานหลัก
 *   - ขึ้นบอร์ดของคนที่ได้รับ · แจ้งเตือน/เลยกำหนด/ขอเลื่อน/สติกเกอร์ เหมือนงานทั่วไป
 *   - งานหลักอยู่ในโปรเจกต์ → งานย่อยอยู่ในโปรเจกต์/ช่วงงานเดียวกัน (แสดงซ้อนใต้งานหลักบนแผนเวลา/รายการ)
 *   - ลึกชั้นเดียว: งานย่อยสร้างงานย่อยต่อไม่ได้
 * ต่างจากเช็คลิสต์: เช็คลิสต์เป็นข้อติ๊กในงานเดียว ไม่มีคนรับ/วันส่งของตัวเอง ไม่ขึ้นบอร์ด
 */

/** วันนี้ (เวลาไทย) YYYY-MM-DD */
function todayBkk(): string {
  return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
}

export function buildSubtask(
  parent: Task,
  input: { title: string; assigneeId: string; dueDate: string },
  actorId: string,
  ids: { taskId: string },
  nowIso: string
): Task {
  const today = todayBkk();
  const due = input.dueDate < today ? today : input.dueDate;
  // เริ่มตามงานหลัก (ถ้ายังไม่ถึง) แต่ไม่ย้อนก่อนวันนี้ และไม่เลยวันส่งของตัวเอง
  const parentStart = parent.startDate.slice(0, 10);
  const start = [parentStart < today ? today : parentStart, due].sort()[0]!;
  return {
    id: ids.taskId,
    title: input.title,
    description: "",
    status: "todo",
    priority: parent.priority,
    taskMode: "individual",
    assigneeIds: [input.assigneeId],
    assignedById: actorId,
    departmentIds: departmentIdsOf([input.assigneeId]),
    startDate: `${start}T00:00:00.000Z`,
    dueDate: `${due}T00:00:00.000Z`,
    originalDueDate: `${due}T00:00:00.000Z`,
    attachments: [],
    comments: [],
    revisions: [],
    reactions: [],
    checklist: [],
    completedAssigneeIds: [],
    showChecklistOnCard: false,
    parentId: parent.id,
    ...(parent.project ? { project: { projectId: parent.project.projectId, sectionId: parent.project.sectionId, dependsOn: [] } } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/** งานย่อยของงานนี้ (เรียงตามวันส่ง) */
export function subtasksOf(tasks: Task[], parentId: string): Task[] {
  return tasks.filter((t) => t.parentId === parentId).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
