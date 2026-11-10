/**
 * PM แบบนับรอบ (ผู้ใช้ 2/11/2569) — กติกาล้วน ไม่แตะฐานข้อมูล เทสต์ได้
 *
 *   ใบงานของแต่ละรอบเปิด "ในวันของรอบ" แล้วมีเวลาทำ leadDays วัน (ค่าเริ่มต้น 14) กำหนดส่ง = วันของรอบ + leadDays
 *   (ผู้ใช้ 10/11/2569 — เดิมเปิดก่อนวันของรอบ 14 วัน กำหนดส่ง = วันของรอบ) · คนตั้ง PM เปิดรอบในอนาคตมาทำก่อนได้
 *   เลยกำหนดแล้วหักทันที (ไม่มีผ่อนผัน) ทำไม่ทันให้ "ขอเลื่อนกำหนดส่ง" พร้อมเหตุผล
 *   รอบถัดไปนับตามแผน ไม่ใช่วันปิดงาน — ใบเก่ายังค้าง ใบรอบใหม่ก็เปิดซ้อนได้
 *   ค้างพร้อมกัน 2 รอบขึ้นไป → CEO ตัดสิน (ไม่ต้องทำ / หักหรือไม่หัก / รวบเป็นใบเดียว)
 *
 * เป็นค่าพื้นฐานของทุกบริษัท (ผู้ใช้ 4/11/2569 "ให้เลือกติ๊กทำไม") ไม่มีหน้าตั้งค่า · performance_settings.pm_rounds_from = วันเริ่มนับ
 * ตั้งเป็น null ด้วย SQL = กลับไปแบบเดิม สำหรับกรณีฉุกเฉินเท่านั้น
 * แผนแบบ "นับครั้ง" (totalRounds) รอนัดวันทีละครั้ง ไม่มีรอบให้นับ ⇒ ใช้แบบเดิมเสมอ
 */
import { freqMonths, freqWeekDays, nextDueAfterCompletion } from "@/modules/maintenance/lib/pm-schedule";

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

/** กำหนดส่งของใบรอบ = สิ้นวัน (วันของรอบ + เวลาทำ) ตามเวลาไทย — ผู้ใช้ 10/11/2569 "ถึงวันแล้วให้เวลา 14 วัน" */
export function roundDueAt(round: Date, windowDays: number = DEFAULT_PM_LEAD_DAYS): Date {
  return new Date(`${ymd(new Date(round.getTime() + windowDays * DAY))}T23:59:59.999+07:00`);
}

/** วันที่เปิดใบของรอบนี้ = วันของรอบเอง (ไม่เปิดล่วงหน้าแล้ว) — leadDays ใช้เป็นเวลาทำหลังเปิด */
export function roundOpensOn(round: Date, _leadDays?: number): Date {
  return round;
}

/**
 * ใบรอบอัตโนมัติที่ค้างจากกติกาเดิม (เปิดก่อนวัน 14 วัน กำหนดส่ง = วันของรอบ) — ตอนเปลี่ยนกติกา:
 *   "close"  = ยังไม่ถึงวันของรอบ + ยังไม่มีคนรับงาน → ปิดไปก่อน ถึงวันแล้วระบบเปิดใหม่ (ผู้ใช้ "อันไหนเปิดมาก่อนก็ปิดไปก่อน")
 *   "extend" = ถึงวันแล้ว หรือมีคนรับงานแล้ว แต่กำหนดส่งยังเร็วกว่ากติกาใหม่ → ขยายเป็นวันของรอบ + เวลาทำ ไม่หักคะแนน
 * ใบที่ตรงกติกาใหม่แล้วได้ null — เรียกซ้ำกี่ครั้งก็ไม่เปลี่ยนอะไร
 */
export function windowTransition(
  wo: { status: string; pmRoundDate: Date | null; dueDate: Date | null; autoCreated: boolean },
  windowDays: number,
  today: Date = todayBkkDate(),
): "close" | "extend" | null {
  if (!wo.autoCreated || !wo.pmRoundDate) return null;
  if (wo.status !== "open" && wo.status !== "in_progress") return null;
  // ปิดเฉพาะใบที่เปิดตามกติกาเดิมจริง ๆ (กำหนดส่ง = วันของรอบ) — ใบที่คนตั้ง PM ย้ายวัน/เลื่อนแล้ว ไม่ปิด
  if (wo.status === "open" && wo.pmRoundDate.getTime() > today.getTime() && !!wo.dueDate && wo.dueDate.getTime() <= roundDueAt(wo.pmRoundDate, 0).getTime()) return "close";
  const due = roundDueAt(wo.pmRoundDate, windowDays);
  return !wo.dueDate || wo.dueDate.getTime() < due.getTime() ? "extend" : null;
}

/** บรรทัดในรายละเอียดใบรอบ — ตัวแก้วันในแผนหาบรรทัดนี้ด้วย ROUND_DESC_RE */
export function roundDescLine(roundLabel: string, dueLabel: string): string {
  return `รอบวันที่ ${roundLabel} · ทำให้เสร็จภายใน ${dueLabel}`;
}
export const ROUND_DESC_RE = /รอบ(?:ครบกำหนด|วันที่) .*/;

/** รอบถัด ๆ ไปของแผน ที่คนตั้ง PM เลือกมาทำก่อนได้ (ไม่รวมรอบที่มีใบแล้ว) */
export function upcomingRounds(pm: RoundPm, count: number, taken: Set<string> = new Set()): Date[] {
  const out: Date[] = [];
  let cur: RoundPm = { ...pm };
  for (let i = 0; i < count * 3 && out.length < count; i++) {
    if (!taken.has(ymd(cur.nextDueDate))) out.push(cur.nextDueDate);
    const n = nextRound(cur);
    if (n.nextDue.getTime() <= cur.nextDueDate.getTime()) break;
    cur = { ...cur, nextDueDate: n.nextDue, anchorDate: n.anchor };
  }
  return out;
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

const WEEKDAY_TH = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

/**
 * ข้อความใต้ช่องวันของฟอร์มแผน PM — "ทุกวันจันทร์" / "ทุกวันที่ 3" กันเลือกวันผิด (ช่องวันแสดงตัวเลขตามเครื่อง อ่านสลับวัน/เดือนได้)
 * รอบต่อปีกับจำกัดจำนวนครั้งไม่ได้ซ้ำแบบเดียวกันทุกรอบ จึงไม่บอกวันซ้ำ
 */
export function pmRepeatLabel(due: string, frequency: string, mode: string): string | null {
  if (mode !== "continuous" || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  const d = new Date(`${due}T00:00:00.000Z`);
  const weekDays = freqWeekDays(frequency);
  if (weekDays != null) {
    const name = `วัน${WEEKDAY_TH[d.getUTCDay()]}`;
    return weekDays === 7 ? `ทุก${name}` : `ทุก ${weekDays / 7} สัปดาห์ ${name}`;
  }
  const months = freqMonths(frequency) ?? 1;
  return months === 1 ? `ทุกวันที่ ${d.getUTCDate()} ของเดือน` : `ทุก ${months} เดือน วันที่ ${d.getUTCDate()}`;
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
  // ใบรอบแบบกลุ่มต่อท้ายด้วยคน (แผน:รอบ:ใบ:คน)
  return parts.length >= 3 && parts[2] ? parts[2] : null;
}

/** ค้างพร้อมกันกี่รอบถึงส่งให้ CEO ตัดสิน */
export const PILEUP_MIN_ROUNDS = 2;
