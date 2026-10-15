/** ชนิดข้อมูลของโมดูลคนงานรายวัน — ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และหน้าจอ (ไม่มี I/O) */

/**
 * สถานะของวัน: m=มา · x=ขาด (ลงเข้าหลังเวลาเข้ากะ) · n=ไม่มา · o=หยุด (Day-Off ผู้ดูแลลง) · l=ลาประเภทอื่น
 * r=วันหยุดตามกะ · ""=ยังไม่มีข้อมูล (วันข้างหน้า/วันนี้ที่ยังไม่ลงเวลา)
 */
export type DayStatus = "m" | "x" | "n" | "o" | "l" | "r" | "";

export interface DayCell {
  s: DayStatus;
  inAt?: string;
  outAt?: string;
  /** ลงออกก่อนเลิกกะ (ยังนับว่ามา) */
  early?: boolean;
  ot?: { id: string; start: string; end: string; minutes: number; note: string; byName: string };
  override?: { reason: string; byName: string; at: string };
  leave?: { id: string; name: string; dayOff: boolean; byName: string | null; at: string };
}

export interface WorkerMonth {
  userId: string;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
  employmentId: string | null;
  employeeCode: string | null;
  shiftId: string | null;
  shiftName: string | null;
  shiftStart: number | null;
  shiftEnd: number | null;
  /** กะเริ่มมีผลวันข้างหน้า (ผูกไว้ล่วงหน้า) — null = มีผลแล้ว */
  shiftFrom: string | null;
  /** key = วันที่ของเดือน (1–31) */
  cells: Record<number, DayCell>;
}

export interface MonthData {
  month: string;
  days: number;
  today: string;
  workers: WorkerMonth[];
  dayOffTypeId: string | null;
  shifts: { id: string; name: string; start: number; end: number }[];
}

export interface OtEntry {
  id: string;
  employmentId: string;
  date: string;
  start: string;
  end: string;
  minutes: number;
  note: string;
  byUserId: string;
  byName: string;
  at: string;
}

export interface OverrideEntry {
  employmentId: string;
  date: string;
  reason: string;
  byUserId: string;
  byName: string;
  at: string;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "17:00","19:00" → 120 · ข้ามเที่ยงคืนได้ (22:00–02:00 = 240) */
export function otMinutes(start: string, end: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number) as [number, number];
    return h * 60 + m;
  };
  let diff = toMin(end) - toMin(start);
  if (diff <= 0) diff += 1440;
  return diff;
}

export function minutesToHm(minutes: number | null): string {
  if (minutes === null) return "—";
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function hoursLabel(minutes: number): string {
  if (minutes === 0) return "0";
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} ชม.`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
