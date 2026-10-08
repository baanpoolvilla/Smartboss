import { AlarmClockOff, Hourglass } from "lucide-react";
import { statusMeta, statusIcon } from "@/modules/report_task/lib/task-meta";
import { statusColors, chartColors } from "@/modules/report_task/lib/chart-colors";
import { sortTasksForDisplay } from "@/modules/report_task/lib/task-flags";
import type { Task } from "@/modules/report_task/types";
import type { BoardColumn } from "./kanban-column";

/**
 * คอลัมน์ตามสถานะ — ใช้ร่วมกันระหว่างบอร์ดหลัก (groupBy="status") กับหน้าเจาะรายแผนก
 * (DepartmentTopicsBoard) ให้แบ่งงานเหมือนกันทุกที่
 *
 * 4 คอลัมน์ไม่ซ้อนกัน: "รอตรวจสอบ" ไม่ใช่ TaskStatus จริง (status==="done" && !reviewedBy) —
 * งานที่ส่งแล้วรออยู่ตรงนี้จนมีคนตรวจ (markReviewed/rejectReview ใน task-store.ts)
 * "เสร็จสิ้น" เก็บไว้ให้งานที่ตรวจแล้วจริง ๆ — รวม 4 คอลัมน์ = งานทั้งหมดพอดี ไม่นับซ้ำ
 * งานเลยกำหนดไม่มีคอลัมน์ของตัวเอง ค้างอยู่ใน "รอดำเนินการ"/"กำลังทำ" มีป้ายแดงบนการ์ด (DueDateBadge)
 *
 * overdueOnly ("เลยกำหนดเท่านั้น"): ยุบเหลือรายการเดียว — แบ่ง 4 คอลัมน์ตามปกติจะได้
 * "รอตรวจสอบ"/"เสร็จสิ้น" ว่างตลอด (งานเสร็จแล้วไม่มีทางเลยกำหนด ดู dueUrgency)
 */
export function buildStatusColumns(tasks: Task[], overdueOnly = false): BoardColumn[] {
  if (overdueOnly) {
    return [
      {
        id: "overdue",
        label: "เลยกำหนด",
        accent: chartColors.red,
        icon: AlarmClockOff,
        tasks: sortTasksForDisplay(tasks),
        derived: true,
        emptyMessage: "ไม่มีงานเลยกำหนด 🎉",
      },
    ];
  }
  return [
    {
      id: "todo",
      label: statusMeta.todo.label,
      accent: chartColors.gray,
      icon: statusIcon.todo,
      tasks: sortTasksForDisplay(tasks.filter((t) => t.status === "todo")),
    },
    {
      id: "in_progress",
      label: statusMeta.in_progress.label,
      accent: statusColors.in_progress,
      icon: statusIcon.in_progress,
      tasks: sortTasksForDisplay(tasks.filter((t) => t.status === "in_progress")),
    },
    {
      id: "review",
      label: "รอตรวจสอบ",
      accent: chartColors.greenPale,
      icon: Hourglass,
      tasks: sortTasksForDisplay(tasks.filter((t) => t.status === "done" && !t.reviewedBy)),
      derived: true,
      emptyMessage: "ไม่มีงานรอตรวจสอบ 🎉",
    },
    {
      id: "done",
      label: statusMeta.done.label,
      accent: chartColors.greenDeep,
      icon: statusIcon.done,
      tasks: sortTasksForDisplay(tasks.filter((t) => t.status === "done" && !!t.reviewedBy)),
    },
  ];
}
