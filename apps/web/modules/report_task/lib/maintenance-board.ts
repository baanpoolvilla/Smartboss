import { presetRange } from "@/modules/report_task/lib/date-filter";
import { getUser } from "@/modules/report_task/lib/directory";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { taskPriorityOrder } from "@/modules/report_task/lib/task-meta";
import type { TaskFilterState } from "@/modules/report_task/lib/task-filter";
import type { Task, TaskPriority } from "@/modules/report_task/types";

/**
 * ใบงานซ่อม / สั่งซื้ออุปกรณ์ บนบอร์ดงาน (Kanban) — แสดงอย่างเดียว กดแล้วไปหน้านั้นในแจ้งซ่อม
 * ("ให้งานแจ้งซ่อมมาแสดงใน task/kanban แค่ไปแสดงอย่างเดียว ให้รู้ว่ามีงานนี้วันนี้ ... รวมถึงสั่งซื้ออุปกรณ์")
 *
 * ข้อมูลมาจาก GET /api/report-task/maintenance-board (lib/db/maintenance-board.ts) — การ์ดเหล่านี้ไม่ใช่ Task
 * ไม่นับในตัวเลขสรุปด้านบนของบอร์ด/คะแนน/สถิติงาน ตัวกรองเดิมของบอร์ดใช้กับมันผ่าน matchesMaintenanceFilters
 */
export type MaintenanceKind = "wo" | "po";
export type BoardKind = "task" | MaintenanceKind;
export type MaintenanceColumn = "todo" | "in_progress" | "review" | "done";

export interface MaintenanceBoardItem {
  kind: MaintenanceKind;
  id: string;
  /** WO-2569-0276 / PR-… */
  code: string;
  title: string;
  /** คอลัมน์บนบอร์ดแบบจัดกลุ่มตามสถานะ */
  column: MaintenanceColumn;
  /** สถานะจริงของใบ อ่านเป็นภาษาคน — "รอ CEO อนุมัติ", "กำลังซ่อม" */
  statusLabel: string;
  /** ใบงาน: ความสำคัญของใบ (ด่วน = ด่วนมาก) · ใบสั่งซื้อไม่มีความสำคัญ = ปานกลาง */
  priority: TaskPriority;
  /** ใบงาน: กำหนดเสร็จ (ISO) · ใบสั่งซื้อไม่มีกำหนด = null */
  dueDate: string | null;
  createdAt: string;
  /** ใบงานที่เลยกำหนดเสร็จแล้วยังไม่ปิด (ใบสั่งซื้อไม่มีกำหนด เลยไม่เคยเลย) */
  overdue: boolean;
  /** คนรับผิดชอบหลัก — ใบงาน: ผู้รับผิดชอบ · สั่งซื้อ: ผู้ซื้อ (ยังไม่มี = คนเปิด PR) · ใช้กับตัวกรองแผนก/รูปบนการ์ด */
  responsibleId: string | null;
  /** ทุกคนที่เกี่ยวกับใบนี้ — ตัวกรอง "พนักงาน" จับคนในนี้ */
  involvedIds: string[];
  /** ชื่อบ้าน */
  place: string | null;
  /** หน้าในแจ้งซ่อม */
  href: string;
}

/** วันที่ใช้กับตัวกรองช่วงเวลาและการเรียง — กำหนดเสร็จ ถ้าไม่มีใช้วันที่เปิดใบ */
export function maintenanceDate(item: MaintenanceBoardItem): string {
  return item.dueDate ?? item.createdAt;
}

/** ตัวกรองเดิมของบอร์ด แปลมาใช้กับใบงาน/สั่งซื้อ (ตารางที่ตกลงกันไว้) */
export function matchesMaintenanceFilters(item: MaintenanceBoardItem, filters: TaskFilterState): boolean {
  if (filters.assigneeId !== "all" && !item.involvedIds.includes(filters.assigneeId)) return false;
  // "กำลังติดตาม" (คนมอบหมาย/คนกดติดตาม) เป็นแนวคิดของงานเท่านั้น
  if (filters.assignedById !== "all") return false;
  if (filters.departmentId !== "all") {
    const dept = item.responsibleId ? getUser(item.responsibleId)?.departmentId : undefined;
    if (dept !== filters.departmentId) return false;
  }
  if (filters.priority !== "all" && item.priority !== filters.priority) return false;
  if (filters.penalty !== "all") {
    // หักคะแนน/รอหักเป็นเรื่องของงาน — ใบซ่อมมีแค่ "เลยกำหนด"
    if (filters.penalty !== "overdue" || !item.overdue) return false;
  }
  const range = presetRange(filters.preset, filters.customFrom, filters.customTo);
  if (range) {
    const at = new Date(maintenanceDate(item)).getTime();
    if (at < range.from.getTime() || at > range.to.getTime()) return false;
  }
  if (filters.quickView !== "all") {
    if (filters.quickView === "todo" && item.column !== "todo") return false;
    if (filters.quickView === "inProgress" && item.column !== "in_progress") return false;
    if (filters.quickView === "overdue" && !item.overdue) return false;
    if (filters.quickView === "review" && item.column !== "review") return false;
    if (filters.quickView === "done" && item.column !== "done") return false;
  }
  return true;
}

export type BoardEntry = { type: "task"; task: Task } | { type: "mx"; item: MaintenanceBoardItem };

/**
 * เรียงงานกับใบซ่อมปนกันด้วยกติกาเดียวกับ sortTasksForDisplay (task-flags.ts): ยังไม่เสร็จก่อน → เลยกำหนดก่อน
 * → (ในกลุ่มเสร็จ: รอตรวจก่อนตรวจแล้ว) → ความสำคัญสูงก่อน → กำหนดใกล้ก่อน → สร้างก่อน
 */
export function sortBoardEntries(entries: BoardEntry[]): BoardEntry[] {
  const key = (e: BoardEntry) => {
    if (e.type === "task") {
      const t = e.task;
      const done = t.status === "done" ? 1 : 0;
      return {
        done,
        overdue: !done && dueUrgency(t) === "overdue" ? 0 : 1,
        reviewed: t.reviewedBy ? 1 : 0,
        pri: taskPriorityOrder.indexOf(t.priority),
        due: new Date(t.dueDate).getTime(),
        created: new Date(t.createdAt).getTime(),
      };
    }
    const i = e.item;
    const done = i.column === "done" ? 1 : 0;
    return {
      done,
      overdue: i.overdue ? 0 : 1,
      reviewed: done,
      pri: taskPriorityOrder.indexOf(i.priority),
      due: new Date(maintenanceDate(i)).getTime(),
      created: new Date(i.createdAt).getTime(),
    };
  };
  return entries
    .map((e) => ({ e, k: key(e) }))
    .sort((a, b) => {
      if (a.k.done !== b.k.done) return a.k.done - b.k.done;
      if (a.k.overdue !== b.k.overdue) return a.k.overdue - b.k.overdue;
      if (a.k.done === 1 && a.k.reviewed !== b.k.reviewed) return a.k.reviewed - b.k.reviewed;
      if (a.k.pri !== b.k.pri) return a.k.pri - b.k.pri;
      if (a.k.due !== b.k.due) return a.k.due - b.k.due;
      return a.k.created - b.k.created;
    })
    .map((x) => x.e);
}
