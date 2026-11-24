/**
 * ตรรกะของปฏิทิน PM — ล้วน ๆ ไม่มี React เพื่อให้เขียนเทสต์ได้
 *
 * ⚠ ทุกอย่างในไฟล์นี้คิดเป็น "วันตามปฏิทิน" ในรูปสตริง YYYY-MM-DD ไม่ใช่ Date
 *
 * เหตุผล: nextDueDate เป็น @db.Date ⇒ Prisma คืน Date ที่เที่ยงคืน **UTC**
 * ถ้าเอาไปเข้า new Date(...).getDate() บนเครื่องที่ไม่ใช่ UTC วันจะเลื่อนไปหนึ่งวัน
 * เงียบ ๆ (ไทย UTC+7 จะเลื่อนเฉพาะบางเคส ทดสอบบนเครื่อง dev แล้วไม่เจอ แต่ไป
 * เจอบนเซิร์ฟเวอร์) — คิดเป็นสตริงตั้งแต่ต้นทางจึงไม่มีทางเลื่อนเลย
 */

import { nextDueAfterCompletion } from "./pm-schedule";

export const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/** เริ่มสัปดาห์วันอาทิตย์ ให้ตรงกับปฏิทินที่คนไทยคุ้น */
export const THAI_DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

export interface YearMonth {
  year: number;
  /** 0 = มกราคม */
  month: number;
}

export interface CalendarCell {
  iso: string;
  day: number;
  /** false = วันของเดือนก่อน/ถัดไปที่เติมให้สัปดาห์เต็ม */
  inMonth: boolean;
}

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

export function isoOf(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function parseIso(iso: string): YearMonth & { day: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y ?? 1970, month: (m ?? 1) - 1, day: d ?? 1 };
}

/** ปี พ.ศ. — โมดูลนี้ใช้ พ.ศ. ทุกที่ (ต่างจากโมดูลรายงานและงานที่ใช้ ค.ศ.) */
export function thaiMonthLabel(ym: YearMonth): string {
  return `${THAI_MONTHS[ym.month]} ${ym.year + 543}`;
}

export function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const total = ym.year * 12 + ym.month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export function monthOfIso(iso: string): YearMonth {
  const p = parseIso(iso);
  return { year: p.year, month: p.month };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * ช่องทั้งหมดของตารางเดือน เริ่มวันอาทิตย์ และเติมให้ครบสัปดาห์เสมอ
 *
 * คืน 35 หรือ 42 ช่อง (5 หรือ 6 สัปดาห์) — ไม่ตัดสัปดาห์สุดท้ายทิ้งแม้จะว่าง
 * เพราะความสูงของตารางที่เปลี่ยนไปมาระหว่างเดือนทำให้ปุ่มเลื่อนเดือนขยับหนีนิ้ว
 */
export function monthGrid(ym: YearMonth): CalendarCell[] {
  const { year, month } = ym;
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const total = daysInMonth(year, month);
  const prev = shiftMonth(ym, -1);
  const prevTotal = daysInMonth(prev.year, prev.month);
  const next = shiftMonth(ym, 1);

  const cells: CalendarCell[] = [];
  for (let i = firstDow - 1; i >= 0; i--) {
    const day = prevTotal - i;
    cells.push({ iso: isoOf(prev.year, prev.month, day), day, inMonth: false });
  }
  for (let day = 1; day <= total; day++) {
    cells.push({ iso: isoOf(year, month, day), day, inMonth: true });
  }
  const weeks = Math.ceil(cells.length / 7);
  const target = weeks * 7;
  for (let day = 1; cells.length < target; day++) {
    cells.push({ iso: isoOf(next.year, next.month, day), day, inMonth: false });
  }
  return cells;
}

// ─── สถานะของแผน PM ───────────────────────────────────────────

export type PmStatusKey =
  | "overdue"
  | "dueSoon"
  | "hasWorkOrder"
  | "awaitingSchedule"
  | "onTrack";

/**
 * ลำดับการตัดสินสำคัญ — เช็ค awaitingSchedule ก่อนทุกอย่าง
 *
 * แผนที่เพิ่งทำเสร็จแล้วรอนัดวันครั้งถัดไป ยังถือ nextDueDate เก่าค้างอยู่ ซึ่งเป็น
 * วันที่ผ่านไปแล้ว ถ้าเช็ค overdue ก่อนจะขึ้นแดงว่า "เกินกำหนด" ทั้งที่ทำเสร็จแล้ว
 */
export function pmStatusOf(s: {
  awaitingSchedule: boolean;
  hasPendingWorkOrder: boolean;
  daysUntilDue: number;
}): PmStatusKey {
  if (s.awaitingSchedule) return "awaitingSchedule";
  if (s.hasPendingWorkOrder) return "hasWorkOrder";
  if (s.daysUntilDue < 0) return "overdue";
  if (s.daysUntilDue <= 7) return "dueSoon";
  return "onTrack";
}

/**
 * จัดแผน PM ลงช่องวันของปฏิทิน
 *
 * แผนที่ "รอนัดวัน" ไม่ถูกวางลงปฏิทินโดยตั้งใจ — วันที่มันถืออยู่คือรอบที่ทำไปแล้ว
 * ไม่ใช่นัดครั้งหน้า วางลงไปก็เป็นการบอกวันที่ผิด (หน้าจอจึงต้องมีแถบแยกให้มันด้วย
 * ไม่งั้นแผนกลุ่มนี้จะไม่มีทางถูกมองเห็นอีกเลย)
 */
export function groupByDueDate<
  T extends { nextDueInput: string; awaitingSchedule: boolean },
>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    if (r.awaitingSchedule) continue;
    const list = map.get(r.nextDueInput);
    if (list) list.push(r);
    else map.set(r.nextDueInput, [r]);
  }
  return map;
}

// ─── รอบของแผนบนปฏิทินเดือน (ผู้ใช้ 24/11/2569) ─────────────────────
//
// เดิมวางแต่ละแผนลงวันเดียว = nextDueDate ⇒ (1) วันที่ผ่านไปแล้วว่างเปล่า (2) แผนแบบนับรอบพอถึงวันของรอบ
// ระบบเปิดใบแล้วเลื่อน nextDueDate ไปรอบหน้า รอบปัจจุบันที่เปิดใบอยู่เลยหายจากปฏิทิน และถ้ารอบหน้าตก
// เดือนถัดไป ทั้งเดือนนี้ไม่เห็นแผนนั้นเลย ("วัดค่าน้ำมันไม่ขึ้นทั้งที่ตั้งไว้แล้ว")
//
// ตอนนี้แต่ละวันของรอบได้ 1 รายการ:
//   done    = ใบของรอบนั้นปิดแล้ว (จาง)
//   open    = ใบของรอบนั้นยังเปิดอยู่
//   planned = รอบที่จะถึง — ไล่จาก nextDueDate ตามความถี่ด้วยสูตรเดียวกับที่ระบบใช้เปิดใบจริง (nextDueAfterCompletion)

export type PmOccurrenceKind = "done" | "open" | "planned";

export interface PmHistoryRound {
  /** YYYY-MM-DD วันของรอบ (pmRoundDate) หรือวันกำหนดของใบแบบเดิม */
  iso: string;
  kind: "done" | "open";
  workOrderId: string;
}

export interface PmCalendarSource {
  id: string;
  nextDueInput: string;
  awaitingSchedule: boolean;
  /** รหัสความถี่ (monthly, weekly, …) */
  frequency: string;
  roundsPerYear: number | null;
  /** YYYY-MM-DD | null */
  anchorInput: string | null;
  mode: "continuous" | "yearlyRounds" | "limitedCount";
  history: PmHistoryRound[];
}

export interface PmOccurrence<T> {
  row: T;
  kind: PmOccurrenceKind;
  workOrderId?: string;
}

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoOfDate = (d: Date) => d.toISOString().slice(0, 10);

/** วันของรอบที่จะถึงของแผนนี้ ตั้งแต่ nextDueDate จนถึง lastIso (รวม) */
export function plannedRounds(src: PmCalendarSource, lastIso: string, max = 120): string[] {
  if (src.awaitingSchedule || !/^\d{4}-\d{2}-\d{2}$/.test(src.nextDueInput)) return [];
  const out: string[] = [];
  let cur = { nextDueDate: utc(src.nextDueInput), anchorDate: src.anchorInput ? utc(src.anchorInput) : null, frequency: src.frequency, roundsPerYear: src.roundsPerYear };
  // แผนจำกัดจำนวนครั้ง — นัดวันทีละครั้ง ไม่มีรอบถัดไปให้ทาย
  const single = src.mode === "limitedCount";
  for (let i = 0; i < max; i++) {
    const iso = isoOfDate(cur.nextDueDate);
    if (iso > lastIso) break;
    out.push(iso);
    if (single) break;
    const n = nextDueAfterCompletion(cur, cur.nextDueDate);
    if (n.nextDue.getTime() <= cur.nextDueDate.getTime()) break; // ความถี่เพี้ยน — กันวนไม่จบ
    cur = { ...cur, nextDueDate: n.nextDue, anchorDate: n.anchor };
  }
  return out;
}

/** รายการทุกวันของเดือน ym: ใบที่เปิด/ปิดแล้วตามวันของรอบ + รอบที่จะถึง (วันเดียวกันมีใบแล้ว ไม่ซ้ำ) */
export function occurrencesInMonth<T extends PmCalendarSource>(rows: T[], ym: YearMonth): Map<string, PmOccurrence<T>[]> {
  const first = isoOf(ym.year, ym.month, 1);
  const last = isoOf(ym.year, ym.month, daysInMonth(ym.year, ym.month));
  const map = new Map<string, PmOccurrence<T>[]>();
  const add = (iso: string, occ: PmOccurrence<T>) => {
    const list = map.get(iso);
    if (list) list.push(occ);
    else map.set(iso, [occ]);
  };
  for (const row of rows) {
    const taken = new Set<string>();
    for (const h of row.history) {
      taken.add(h.iso);
      if (h.iso >= first && h.iso <= last) add(h.iso, { row, kind: h.kind, workOrderId: h.workOrderId });
    }
    for (const iso of plannedRounds(row, last)) {
      if (iso < first || taken.has(iso)) continue;
      add(iso, { row, kind: "planned" });
    }
  }
  return map;
}
