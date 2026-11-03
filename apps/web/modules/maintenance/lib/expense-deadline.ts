/**
 * กำหนดบันทึกค่าใช้จ่ายของใบงานที่ปิดแล้ว (ผู้ใช้ 3/11/2569 "สร้างให้เป็นงานของเค้า มี due date")
 *
 * เปิดใช้รายบริษัทด้วย performance_settings.expense_track_from — null = ไม่มีอะไรเปลี่ยนเลย
 *   ใบค้าง = status completed · requiresExpense · ไม่ใช่ใบส่วนตัว · ยังไม่มีแถวค่าใช้จ่ายผูกอยู่
 *   กำหนด = วันปิดงาน + expense_track_days (ค่าเริ่มต้น 14) สิ้นวันเวลาไทย · CEO อนุมัติเลื่อน = work_orders.expense_due_date
 *   ใบที่ปิดก่อนวันเริ่มใช้ (ของค้างเก่า) นับ 14 วันจากวันเริ่มใช้ และไม่หักคะแนน — ถ้าหัก ของค้างทั้งกองจะหักพร้อมกันวันเดียว
 *   มี PR/PO หรือใบเบิกยังไม่จบ = ยังไม่เป็นงานและไม่นับเวลา เริ่มนับเมื่อต้นทางจบ (clockFrom) — ดู data/expense-tracking.ts expenseLinks
 */
export interface ExpenseTracking {
  from: Date | null;
  days: number;
  recorderIds: string[];
}

const DAY = 86_400_000;
const BKK = 7 * 3600_000;

const ymdBkk = (d: Date) => new Date(d.getTime() + BKK).toISOString().slice(0, 10);

/** เปิดใช้แล้วหรือยัง (ถึงวันเริ่มใช้แล้ว) */
export function trackingActive(t: ExpenseTracking, now: Date = new Date()): boolean {
  return !!t.from && ymdBkk(t.from) <= ymdBkk(now);
}

/** ของค้างเก่า = ปิดงานก่อนวันเริ่มใช้ */
export function isExpenseBacklog(wo: { completedAt: Date | null }, t: ExpenseTracking): boolean {
  return !!t.from && !!wo.completedAt && ymdBkk(wo.completedAt) < ymdBkk(t.from);
}

/** วันครบกำหนดบันทึก — สิ้นวันเวลาไทย */
export function expenseDueAt(wo: { completedAt: Date | null; expenseDueDate?: Date | null; clockFrom?: Date | null }, t: ExpenseTracking): Date {
  if (wo.expenseDueDate) return wo.expenseDueDate;
  const base = isExpenseBacklog(wo, t) || !wo.completedAt ? t.from! : wo.completedAt;
  const start = wo.clockFrom && wo.clockFrom > base ? wo.clockFrom : base;
  const day = new Date(Date.parse(`${ymdBkk(start)}T00:00:00Z`) + t.days * DAY).toISOString().slice(0, 10);
  return new Date(`${day}T23:59:59.999+07:00`);
}

/** เหลือกี่วัน นับเป็นวันตามเวลาไทย — 0 = วันนี้ · ติดลบ = เลยมาแล้ว */
export function expenseDaysLeft(due: Date, now: Date = new Date()): number {
  return Math.round((Date.parse(ymdBkk(due)) - Date.parse(ymdBkk(now))) / DAY);
}

/** ป้ายเหลือกี่วัน ใช้ร่วมกันทุกหน้า */
export function expenseDaysLabel(daysLeft: number): string {
  if (daysLeft < 0) return `เลยกำหนด ${-daysLeft} วัน`;
  return daysLeft === 0 ? "ครบกำหนดวันนี้" : `เหลือ ${daysLeft} วัน`;
}
