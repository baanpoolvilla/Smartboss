import { presetRange } from "@/modules/report_task/lib/date-filter";
import { getUser } from "@/modules/report_task/lib/directory";
import { dueUrgency, effectiveDueDate } from "@/modules/report_task/lib/task-flags";
import { taskPriorityOrder } from "@/modules/report_task/lib/task-meta";
import type { TaskFilterState } from "@/modules/report_task/lib/task-filter";
import type { Task, TaskPriority } from "@/modules/report_task/types";

/**
 * ใบงานซ่อม บนหน้างาน (บอร์ด/ตาราง/ภาระงาน) — แสดงอย่างเดียว กดแล้วไปหน้านั้นในแจ้งซ่อม
 * ("ให้งานแจ้งซ่อมมาแสดงใน task/kanban แค่ไปแสดงอย่างเดียว ให้รู้ว่ามีงานนี้วันนี้")
 * สั่งซื้ออุปกรณ์เคยแสดงด้วย เอาออกแล้ว — ไม่มีกำหนดส่ง ไม่หักคะแนน ให้ไปดูในโมดูลแจ้งซ่อมแบบเดิม
 * ("สั่งซื้ออุปกรณ์ ไม่หักไม่ต้องเอามาแสดงใน task/kanban ... task แสดงแค่งานและก็ใบงานซ่อมก็พอ")
 *
 * ข้อมูลมาจาก GET /api/report-task/maintenance-board (lib/db/maintenance-board.ts) — การ์ดเหล่านี้ไม่ใช่ Task
 * ไม่นับในตัวเลขสรุปด้านบนของบอร์ด/คะแนน/สถิติงาน ตัวกรองเดิมของบอร์ดใช้กับมันผ่าน matchesMaintenanceFilters
 */
export type MaintenanceKind = "wo";
export type BoardKind = "task" | MaintenanceKind;
export type MaintenanceColumn = "todo" | "in_progress" | "review" | "done";

/**
 * ประเภทย่อยของใบงานซ่อม — ตัวกรอง "ประเภทใบงานซ่อม" + ป้ายบนการ์ด (ผู้ใช้ขอ 20/10/2569 "จะได้ดูได้ถูกจุด")
 * ใบหนึ่งมีได้หลายแบบ: ใบอัตโนมัติ (ระบบเปิดตามรอบ PM) เป็น PM ด้วยเสมอ · มี PO ซ้อนกับแบบไหนก็ได้
 *   normal = ไม่ผูกแผน PM และไม่ใช่ใบอัตโนมัติ · pm = ผูกแผน PM · auto = ระบบเปิดให้เอง · po = มีใบขอซื้อ/สั่งซื้อ (ไม่นับที่ยกเลิก)
 */
export type WoType = "normal" | "pm" | "auto" | "po";
export const WO_TYPES: { id: WoType; label: string; tag: string | null }[] = [
  { id: "normal", label: "ซ่อมทั่วไป", tag: null },
  { id: "pm", label: "PM ตามแผน", tag: "PM" },
  { id: "auto", label: "ใบอัตโนมัติ", tag: "อัตโนมัติ" },
  { id: "po", label: "มี PO", tag: "PO" },
];
/** สีป้ายประเภท (ตัวกรอง + การ์ด ใช้ชุดเดียวกัน) · ซ่อมทั่วไปไม่มีป้าย */
export const WO_TYPE_TAG_BG: Record<WoType, string> = { normal: "", pm: "#7c3aed", auto: "#475569", po: "#c2410c" };
/** ข้อมูลเก่าที่ยังไม่มี woTypes = ซ่อมทั่วไป */
export function woTypesOf(item: MaintenanceBoardItem): WoType[] {
  return item.woTypes && item.woTypes.length > 0 ? item.woTypes : ["normal"];
}

export interface MaintenanceBoardItem {
  kind: MaintenanceKind;
  id: string;
  /** WO-2569-0276 */
  code: string;
  title: string;
  /** คอลัมน์บนบอร์ดแบบจัดกลุ่มตามสถานะ */
  column: MaintenanceColumn;
  /** สถานะจริงของใบ อ่านเป็นภาษาคน — "กำลังซ่อม" */
  statusLabel: string;
  /** ความสำคัญของใบ (ด่วน = ด่วนมาก) */
  priority: TaskPriority;
  /** กำหนดเสร็จ (ISO) · ไม่ได้ตั้ง = null */
  dueDate: string | null;
  createdAt: string;
  /** ใบงานที่เลยกำหนดเสร็จแล้วยังไม่ปิด */
  overdue: boolean;
  /** คนรับผิดชอบหลัก (ยังไม่มี = คนเปิดใบ) · ใช้กับตัวกรองแผนก/รูปบนการ์ด/แถบภาระงาน */
  responsibleId: string | null;
  /** ผู้รับผิดชอบจริงของใบงาน (ยังไม่มอบหมาย = null) — คนที่ได้/โดนคะแนนจากสติกเกอร์ */
  assigneeId: string | null;
  /** ทุกคนที่เกี่ยวกับใบนี้ (รับผิดชอบ/เปิดใบ/CC) */
  involvedIds: string[];
  /** คนเปิดใบ — ตัวกรอง "ที่ฉันมอบหมาย" จับคนนี้ (ใบงานไม่ได้เก็บว่าใครกดมอบหมาย คนเปิดใบคือคนสั่งงาน) */
  createdById?: string | null;
  /** ชื่อบ้าน */
  place: string | null;
  /** หน้าในแจ้งซ่อม */
  href: string;
  /** สติกเกอร์ที่หัวหน้าติดบนการ์ด (มีผลกับคะแนนผู้รับผิดชอบ) — ดู lib/db/work-order-reactions.ts */
  reactions: WorkOrderReaction[];
  /** ประเภทย่อย (ดู WoType) — อ่านผ่าน woTypesOf() */
  woTypes?: WoType[];
}

/** สติกเกอร์ 1 ครั้งบนใบงานซ่อม — ชุดสติกเกอร์เดียวกับงาน คะแนนเข้า targetUserId (ผู้รับผิดชอบตอนที่ติด) */
export interface WorkOrderReaction {
  id: string;
  workOrderId: string;
  stickerId: string;
  byUserId: string;
  targetUserId: string;
  createdAt: string;
}

/** วันที่ใช้กับตัวกรองช่วงเวลาและการเรียง — กำหนดเสร็จ ถ้าไม่มีใช้วันที่เปิดใบ */
export function maintenanceDate(item: MaintenanceBoardItem): string {
  return item.dueDate ?? item.createdAt;
}

/** ตัวกรองเดิมของบอร์ด แปลมาใช้กับใบงานซ่อม (ตารางที่ตกลงกันไว้) */
export function matchesMaintenanceFilters(item: MaintenanceBoardItem, filters: TaskFilterState): boolean {
  // "งานของฉัน"/เลือกผู้รับผิดชอบ = ใบที่คนนั้น **ได้รับมอบหมาย** · "ที่ฉันมอบหมาย" = ใบที่คนนั้นเปิด
  // (ผู้ใช้ขอ 20/10/2569 — เดิม "งานของฉัน" จับทุกคนที่เกี่ยว รวมคนเปิดใบ/CC และ "ที่ฉันมอบหมาย" ไม่ขึ้นใบงานเลย)
  if (filters.assigneeId !== "all" && item.assigneeId !== filters.assigneeId) return false;
  if (filters.assignedById !== "all" && (item.createdById ?? null) !== filters.assignedById) return false;
  if (filters.departmentId !== "all") {
    const dept = item.responsibleId ? getUser(item.responsibleId)?.departmentId : undefined;
    if (dept !== filters.departmentId) return false;
  }
  if (filters.priority !== "all" && item.priority !== filters.priority) return false;
  // ใบซ่อมไม่อยู่ในโปรเจกต์ — เลือกดูโปรเจกต์ไหนก็ไม่ขึ้น (ส่วน "ไม่รวมงานโปรเจกต์" ยังขึ้นตามเดิม)
  if (filters.projectId && filters.projectId !== "all" && filters.projectId !== "none") return false;
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
 * เรียงงานกับใบซ่อมปนกันด้วยกติกาเดียวกับ sortTasksByDueForBoard (task-flags.ts): ยังไม่เสร็จก่อน → เลยกำหนดก่อน
 * → (ในกลุ่มเสร็จ: รอตรวจก่อนตรวจแล้ว) → วันครบใกล้ก่อน (ใบไม่มีวันครบไปท้าย) → ความสำคัญสูงก่อน → สร้างก่อน
 */
export function sortBoardEntries(entries: BoardEntry[]): BoardEntry[] {
  // วันครบกำหนดใกล้สุดขึ้นก่อน งานกับใบงานซ่อมปนกัน (ผู้ใช้ขอ 20/10/2569) — กติกาเดียวกับ sortTasksByDueForBoard
  // ใบงานซ่อมที่ "ไม่ได้ตั้งวันครบกำหนด" ไปต่อท้ายใบ/งานที่มีวันครบ (เดิมใช้วันเปิดใบแทน ทำให้ดูเหมือนใกล้ครบ)
  const key = (e: BoardEntry) => {
    if (e.type === "task") {
      const t = e.task;
      const done = t.status === "done" ? 1 : 0;
      return {
        done,
        overdue: !done && dueUrgency(t) === "overdue" ? 0 : 1,
        reviewed: t.reviewedBy ? 1 : 0,
        pri: taskPriorityOrder.indexOf(t.priority),
        due: new Date(effectiveDueDate(t)).getTime(),
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
      due: i.dueDate ? new Date(i.dueDate).getTime() : Number.POSITIVE_INFINITY,
      created: new Date(i.createdAt).getTime(),
    };
  };
  return entries
    .map((e) => ({ e, k: key(e) }))
    .sort((a, b) => {
      if (a.k.done !== b.k.done) return a.k.done - b.k.done;
      if (a.k.overdue !== b.k.overdue) return a.k.overdue - b.k.overdue;
      if (a.k.done === 1 && a.k.reviewed !== b.k.reviewed) return a.k.reviewed - b.k.reviewed;
      if (a.k.due !== b.k.due) return a.k.due - b.k.due;
      if (a.k.pri !== b.k.pri) return a.k.pri - b.k.pri;
      return a.k.created - b.k.created;
    })
    .map((x) => x.e);
}
