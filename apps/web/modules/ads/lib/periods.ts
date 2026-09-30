/**
 * ช่วงเวลาแบบ "YYYY-MM-DD" (วันตามปฏิทิน ไม่มีเวลา) — ไม่มี server-only เพื่อให้
 * ฝั่ง client (ตัวเลือกช่วงเวลา) ใช้ร่วมได้
 */

export interface Period {
  from: string;
  to: string;
}

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(v: unknown): v is string {
  return typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

/** วันนี้ตามเขตเวลาที่ระบุ (ค่าเริ่มต้นเวลาไทย) */
export function todayIn(timeZone = "Asia/Bangkok"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** จำนวนวันในช่วง (นับทั้งต้นและท้าย) */
export function daysInPeriod(p: Period): number {
  return Math.round((Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** ช่วงก่อนหน้าที่ยาวเท่ากัน ต่อท้ายพอดี */
export function previousPeriod(p: Period): Period {
  const len = daysInPeriod(p);
  return { from: addDays(p.from, -len), to: addDays(p.from, -1) };
}

export function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function fromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * รอบครึ่งเดือน (spec §6.6 วันที่ 1 และ 16) — "ครึ่งเดือนที่ผ่านมา เทียบครึ่งเดือนก่อนหน้า"
 *   รันวันที่ 1  → 16..สิ้นเดือนก่อน  เทียบ 1..15 ของเดือนก่อน
 *   รันวันที่ 16 → 1..15 ของเดือนนี้  เทียบ 16..สิ้นเดือนก่อน
 */
export function halfMonthPeriods(today: string): { period: Period; compare: Period } {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const pad = (n: number) => String(n).padStart(2, "0");
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const prevLast = lastDayOfMonth(prevY, prevM);
  const firstHalfPrev = { from: `${prevY}-${pad(prevM)}-01`, to: `${prevY}-${pad(prevM)}-15` };
  const secondHalfPrev = { from: `${prevY}-${pad(prevM)}-16`, to: `${prevY}-${pad(prevM)}-${pad(prevLast)}` };
  if (d >= 16) {
    return { period: { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-15` }, compare: secondHalfPrev };
  }
  return { period: secondHalfPrev, compare: firstHalfPrev };
}

/** 7 วันล่าสุด (ถึงเมื่อวาน) เทียบ 7 วันก่อนหน้า — สรุปรายสัปดาห์ (spec §6.6) */
export function weeklyPeriods(today: string): { period: Period; compare: Period } {
  const period = { from: addDays(today, -7), to: addDays(today, -1) };
  return { period, compare: previousPeriod(period) };
}

/** แบ่งช่วงยาวเป็นท่อนรายเดือน — ใช้ตอน Backfill ย้อนหลังหลายเดือน */
export function monthlyChunks(p: Period): Period[] {
  const out: Period[] = [];
  let cursor = p.from;
  while (cursor <= p.to) {
    const [y, m] = cursor.split("-").map(Number) as [number, number];
    const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}`;
    const end = monthEnd < p.to ? monthEnd : p.to;
    out.push({ from: cursor, to: end });
    cursor = addDays(end, 1);
  }
  return out;
}

export function formatThaiDate(date: string): string {
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" }).format(
    toDbDate(date)
  );
}

export function formatPeriod(p: Period): string {
  return p.from === p.to ? formatThaiDate(p.from) : `${formatThaiDate(p.from)} – ${formatThaiDate(p.to)}`;
}
