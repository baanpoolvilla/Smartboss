/**
 * PM แบบนับรอบ (ผู้ใช้ 2/11/2569) — กติกาล้วน ไม่แตะฐานข้อมูล เทสต์ได้
 *
 *   ใบงานของแต่ละรอบเปิดก่อนวันครบกำหนด leadDays วัน (ค่าเริ่มต้น 14) กำหนดส่ง = วันครบกำหนดของรอบ
 *   เลยกำหนดแล้วหักทันที (ไม่มีผ่อนผัน) ทำไม่ทันให้ "ขอเลื่อนกำหนดส่ง" พร้อมเหตุผล
 *   รอบถัดไปนับตามแผน ไม่ใช่วันปิดงาน — ใบเก่ายังค้าง ใบรอบใหม่ก็เปิดซ้อนได้
 *   ค้างพร้อมกัน 2 รอบขึ้นไป → CEO ตัดสิน (ไม่ต้องทำ / หักหรือไม่หัก / รวบเป็นใบเดียว)
 *
 * เปิดใช้รายบริษัทด้วย performance_settings.pm_rounds_from — null = PM แบบเดิมทุกอย่าง
 * แผนแบบ "นับครั้ง" (totalRounds) รอนัดวันทีละครั้ง ไม่มีรอบให้นับ ⇒ ใช้แบบเดิมเสมอ
 */
import { nextDueAfterCompletion } from "@/modules/maintenance/lib/pm-schedule";

export const DEFAULT_PM_LEAD_DAYS = 14;
/** กันลูปไม่จบถ้าแผนมีวันครบกำหนดเก่ามาก ๆ — เกินนี้รอบถัดไปค่อยเปิดใน cron รอบหน้า */
export const MAX_ROUNDS_PER_RUN = 24;

const DAY = 86_400_000;

/** YYYY-MM-DD ของวันที่แบบ @db.Date (เก็บเป็นเที่ยงคืน UTC) */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** วันนี้ตามเวลาไทย เป็นวันล้วน (เที่ยงคืน UTC) — เทียบกับคอลัมน์ @db.Date ได้ตรง ๆ */
export function todayBkkDate(now: Date = new Date()): Date {
  return new Date(`${new Date(now.getTime() + 7 * 3600e3).toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/** กำหนดส่งของใบรอบ = สิ้นวันครบกำหนดตามเวลาไทย (เหมือนใบที่คนตั้งกำหนดส่งเอง) */
export function roundDueAt(round: Date): Date {
  return new Date(`${ymd(round)}T23:59:59.999+07:00`);
}

/** วันที่เปิดใบของรอบนี้ */
export function roundOpensOn(round: Date, leadDays: number): Date {
  return new Date(round.getTime() - leadDays * DAY);
}

export interface RoundOrg {
  pmRoundsFrom: Date | null;
  pmLeadDays: number;
}

/** บริษัทนี้ใช้ PM แบบนับรอบแล้วหรือยัง (ถึงวันเริ่มแล้ว) */
export function roundModeOn(st: RoundOrg | undefined, today: Date = todayBkkDate()): boolean {
  return !!st?.pmRoundsFrom && st.pmRoundsFrom.getTime() <= today.getTime();
}

/** แผนนี้เดินแบบนับรอบไหม — แผนนับครั้งใช้แบบเดิมเสมอ */
export function pmUsesRounds(st: RoundOrg | undefined, pm: { totalRounds: number | null }, today?: Date): boolean {
  return roundModeOn(st, today) && pm.totalRounds == null;
}

export interface RoundPm {
  nextDueDate: Date;
  anchorDate: Date | null;
  frequency: string;
  roundsPerYear: number | null;
}

/** รอบถัดจากรอบนี้ตามแผน (ไม่ขึ้นกับว่าทำเสร็จวันไหน) */
export function nextRound(pm: RoundPm): { nextDue: Date; anchor: Date } {
  return nextDueAfterCompletion(pm, pm.nextDueDate);
}

/**
 * รอบที่ถึงเวลาเปิดใบแล้ว ตั้งแต่ pm.nextDueDate ไล่ไปตามแผน — คืนรายการรอบ + ค่าที่ต้องเก็บกลับลงแผน
 * (nextDueDate = รอบแรกที่ยังไม่ถึงเวลาเปิด)
 */
export function dueRounds(
  pm: RoundPm,
  leadDays: number,
  today: Date = todayBkkDate(),
): { rounds: Date[]; nextDueDate: Date; anchorDate: Date | null } {
  const rounds: Date[] = [];
  let cur: RoundPm = { ...pm };
  while (rounds.length < MAX_ROUNDS_PER_RUN && roundOpensOn(cur.nextDueDate, leadDays).getTime() <= today.getTime()) {
    rounds.push(cur.nextDueDate);
    const n = nextRound(cur);
    if (n.nextDue.getTime() <= cur.nextDueDate.getTime()) break; // ความถี่เพี้ยน — กันวนไม่จบ
    cur = { ...cur, nextDueDate: n.nextDue, anchorDate: n.anchor };
  }
  return { rounds, nextDueDate: cur.nextDueDate, anchorDate: cur.anchorDate };
}

/** เตือนใบรอบก่อนครบกำหนดกี่วัน (ผู้ใช้ 4/11/2569) */
export const ROUND_REMIND_DAYS = [14, 10, 7, 5, 3, 1, 0];

/**
 * วันนี้ต้องเตือนใบรอบนี้ไหม — เลยกำหนดเตือนทุกวันจนกว่าจะปิด
 * ใบที่เพิ่งเปิดวันนี้ได้แจ้งตอนเปิดไปแล้ว ไม่เตือนซ้ำในวันเดียวกัน
 */
export function shouldRemindRound(daysUntilDue: number, openedToday: boolean): boolean {
  if (daysUntilDue < 0) return true;
  return !openedToday && ROUND_REMIND_DAYS.includes(daysUntilDue);
}

/** ผ่อนผันของใบงานเลยกำหนด — ใบรอบ PM ไม่มีผ่อนผัน ("เลยวันครบกำหนดหักเลย") */
export function overdueGraceDays(wo: { pmRoundDate?: Date | null }, workOrderGraceDays: number): number {
  return wo.pmRoundDate ? 0 : workOrderGraceDays;
}

/** ใบรอบที่ครบกำหนดก่อนวันเริ่มใช้แบบนับรอบ = ของค้างเก่า ไม่หักย้อนหลัง */
export function roundBeforeStart(wo: { pmRoundDate?: Date | null }, pmRoundsFrom: Date | null | undefined): boolean {
  return !!wo.pmRoundDate && !!pmRoundsFrom && wo.pmRoundDate.getTime() < pmRoundsFrom.getTime();
}

/**
 * refId ของคะแนน "ไม่ทำบำรุงรักษาตามรอบ" ของใบรอบ = แผน:รอบ:ใบงาน
 * ส่วนแรกเป็นแผนเหมือนแบบเดิม (ขอแก้คะแนนหาคนสร้างแผนจากตรงนี้) · มีส่วนที่สาม = ใบรอบ (แบบเดิมมีแค่ แผน:รอบ)
 * ใบที่ CEO รวบใช้วันรอบเดียวกับใบเดิมได้ — ใบงานต่อท้ายทำให้ไม่ชนกัน
 */
export function roundDockRefId(pmId: string, round: Date, workOrderId: string): string {
  return `${pmId}:${ymd(round)}:${workOrderId}`;
}

/** ใบงานของคะแนนใบรอบ — null = คะแนน "ไม่ทำตามรอบ" แบบเดิม (แผน:รอบ) */
export function roundDockWorkOrderId(refId: string | null | undefined): string | null {
  const parts = (refId ?? "").split(":");
  return parts.length === 3 && parts[2] ? parts[2] : null;
}

/** ค้างพร้อมกันกี่รอบถึงส่งให้ CEO ตัดสิน */
export const PILEUP_MIN_ROUNDS = 2;
