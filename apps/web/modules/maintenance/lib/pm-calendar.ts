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
