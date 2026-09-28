/**
 * กติกา "คะแนนงานซ่อมที่หักไปแล้ว ยังถูกต้องอยู่ไหม" — แยกจาก cron (data/cron.ts
 * revokeInvalidMaintenanceDocks) ให้เทสต์ได้โดยไม่ต้องมีฐานข้อมูล
 *
 * ทุกเงื่อนไขคืน "เหตุผลที่ต้องคืน" หรือ null (ยังหักถูก) และต้องตรงข้ามกับเงื่อนไขการหัก
 * ของ dockOverdueMaintenance พอดี ไม่งั้น cron จะคืน-หักวนไปมาทุกนาที
 */

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/**
 * งานค้างเก่า = ตรวจพบว่าเลยกำหนดช้ากว่าวันที่เลยกำหนดจริงเกินกี่วัน
 *
 * cron หักทุกนาที งานที่เพิ่งเลยกำหนดจึงโดนหักภายในไม่กี่นาที ถ้าโดนหักหลังเลยกำหนดไปแล้ว
 * หลายวัน แปลว่างานนั้นค้างมาตั้งแต่ก่อนระบบคะแนนเริ่มเห็น (เปิดระบบคะแนนครั้งแรก, ย้ายข้อมูล
 * จาก ChangYai) — เดิมหักทั้งกองพร้อมกันในวันเดียว ("ใบงานเกินกำหนด −36 ×12") ทั้งที่ไม่ได้
 * ปล่อยปละในช่วงที่นับ ใช้ได้แม้บริษัทไม่ได้ตั้ง "วันเริ่มนับคะแนน"
 * (แลกกับ: ถ้า cron หยุดเกินเท่านี้ งานที่เลยกำหนดช่วงนั้นจะไม่โดนหัก)
 */
export const BACKLOG_DAYS = 3;

export function isBacklog(lapse: Date, detectedAt: Date): boolean {
  return detectedAt.getTime() - lapse.getTime() > BACKLOG_DAYS * 86_400_000;
}

export interface DockSettings {
  workOrderGraceDays: number;
  pmGraceDays: number;
  scoringStartDate: Date | null;
}

export interface WorkOrderDock {
  userId: string;
  occurredAt: Date;
}

export interface WorkOrderState {
  status: string;
  dueDate: Date | null;
  completedAt: Date | null;
  assignedTo: string | null;
  caretakerId: string | null;
}

/** "ใบงานเกินกำหนด" ที่หักไปแล้ว — คืนเหตุผลถ้าควรคืน */
export function workOrderDockRevokeReason(
  dock: WorkOrderDock,
  wo: WorkOrderState | undefined,
  st: DockSettings,
): string | null {
  if (!wo) return "ใบงานถูกลบ";
  if (wo.status === "cancelled") return "ใบงานถูกยกเลิก";
  if (!wo.dueDate) return "ใบงานไม่มีกำหนดส่งแล้ว";
  const lapse = addDays(wo.dueDate, st.workOrderGraceDays);
  if (lapse >= dock.occurredAt) return "เลื่อนกำหนดส่งหลังโดนหัก";
  if (wo.completedAt && wo.completedAt <= lapse) return "ปิดงานทันกำหนด";
  if (st.scoringStartDate && lapse < st.scoringStartDate) return "เลยกำหนดก่อนวันเริ่มนับคะแนน";
  if (isBacklog(lapse, dock.occurredAt)) return "งานค้างเก่า (เลยกำหนดก่อนระบบคะแนนเห็น)";
  const stillOpen = wo.status === "open" || wo.status === "in_progress";
  const responsible = wo.assignedTo ?? wo.caretakerId;
  if (stillOpen && responsible !== dock.userId) return "ย้ายผู้รับผิดชอบแล้ว";
  return null;
}

export interface PmState {
  id: string;
  isActive: boolean;
  awaitingSchedule: boolean;
  nextDueDate: Date;
  assignedTo: string | null;
  caretakerId: string | null;
}

export interface LinkedWorkOrder {
  id: string;
  createdAt: Date;
  completedAt: Date | null;
  pmScheduleId: string | null;
  pmScheduleIds: string[];
}

/**
 * "ไม่ทำตามรอบ" ที่หักไปแล้ว (refId = `pmId:YYYY-MM-DD`) — คืนเหตุผลถ้าควรคืน
 * woDockedBy = ใบงาน id → คนที่โดน "ใบงานเกินกำหนด" ของใบนั้น (ไว้จับหักซ้อน)
 */
export function pmDockRevokeReason(
  dock: WorkOrderDock & { refId: string },
  pm: PmState | undefined,
  linkedWos: LinkedWorkOrder[],
  woDockedBy: Map<string, string>,
  st: DockSettings,
): string | null {
  const round = dock.refId.split(":")[1];
  const roundDate = round ? new Date(`${round}T00:00:00.000Z`) : null;
  if (!pm) return "แผน PM ถูกลบ";
  if (!pm.isActive) return "แผน PM ถูกปิดใช้งาน";
  if (!roundDate || Number.isNaN(roundDate.getTime())) return "รอบไม่ถูกต้อง";
  const lapse = addDays(roundDate, st.pmGraceDays);
  if (st.scoringStartDate && lapse < st.scoringStartDate) return "เลยกำหนดก่อนวันเริ่มนับคะแนน";
  if (isBacklog(lapse, dock.occurredAt)) return "งานค้างเก่า (เลยกำหนดก่อนระบบคะแนนเห็น)";
  const stillThisRound = pm.nextDueDate.toISOString().slice(0, 10) === round;
  if (stillThisRound && pm.awaitingSchedule) return "PM รอนัดรอบใหม่";
  const responsible = pm.assignedTo ?? pm.caretakerId;
  if (stillThisRound && responsible !== dock.userId) return "ย้ายผู้รับผิดชอบแล้ว";
  const doubled = linkedWos.some(
    (w) =>
      (w.pmScheduleId === pm.id || w.pmScheduleIds.includes(pm.id)) &&
      woDockedBy.get(w.id) === dock.userId &&
      w.createdAt <= dock.occurredAt &&
      (!w.completedAt || w.completedAt >= roundDate),
  );
  if (doubled) return "ซ้อนกับใบงานเกินกำหนดของ PM เดียวกัน";
  return null;
}
