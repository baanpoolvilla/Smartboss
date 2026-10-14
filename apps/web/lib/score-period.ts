/**
 * รอบคะแนน/เกรด — ไม่ใช่เดือนปฏิทิน แต่ตัดรอบทุกวันที่ X (ค่าเริ่มต้น 25) ของทุกเดือน
 *
 * เกรดเดือน ต.ค. = วันถัดจากวันตัดรอบของ ก.ย. (26 ก.ย.) ถึงวันตัดรอบของ ต.ค. (25 ต.ค.) ตามเวลาไทย
 * เรื่องที่เกิดวันที่ 26 ต.ค. ไปนับในเกรดเดือน พ.ย. · ให้ทันตัดรอบเงินเดือน
 * วันตัดรอบเปลี่ยนเฉพาะบางเดือนได้ (overrides) — เปลี่ยนแล้วรอบเดือนนั้นจบเร็ว/ช้าลง และรอบถัดไปเริ่มตาม
 *
 * ไฟล์นี้ไม่มี I/O (ใช้ได้ทั้งเซิร์ฟเวอร์/หน้าจอ) — โหลด/บันทึกค่าอยู่ที่ score-period-config.ts
 */

export interface ScorePeriodConfig {
  /** วันตัดรอบปกติของทุกเดือน 1–31 — เดือนที่ไม่มีวันนั้น (ตั้ง 31 แต่ ก.พ. มี 28) ใช้วันสุดท้ายของเดือนแทน */
  cutoffDay: number;
  /** "YYYY-MM" → วันตัดรอบของเดือนนั้น (เฉพาะเดือนที่เปลี่ยน) */
  overrides: Record<string, number>;
  /**
   * เดือนนี้และก่อนหน้า = เดือนปฏิทินเต็ม (1 ถึงสิ้นเดือน) — เกรดของเดือนเหล่านั้นตัดไปแล้วก่อนเริ่มใช้รอบ 26–25
   * ถ้าไม่มีค่านี้ รอบแรก (ต.ค.) จะเริ่ม 26 ก.ย. นับวันที่ 26–30 ก.ย. ซ้ำกับเกรด ก.ย. ที่ปิดไปแล้ว
   * ⇒ รอบแรกคือ 1 ต.ค. – 25 ต.ค. แล้วค่อยเป็น 26–25 ตามปกติ
   */
  calendarMonthsUntil?: string;
}

/** เริ่มใช้รอบตัดวันที่ 25 ตั้งแต่เกรด ต.ค. 2569 (เจ้าของระบบสั่ง 2026-10-14) — ก.ย. 2569 ตัดเกรดแบบเดือนปฏิทินไปแล้ว */
export const SCORE_PERIOD_STARTS_AFTER = "2026-09";

export const DEFAULT_SCORE_PERIOD: ScorePeriodConfig = {
  cutoffDay: 25,
  overrides: {},
  calendarMonthsUntil: SCORE_PERIOD_STARTS_AFTER,
};

const THAI_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

function parseMonth(month: string): [number, number] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return [y, m];
}

export function shiftPeriodMonth(month: string, delta: number): string {
  const [y, m] = parseMonth(month);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** วันตัดรอบของเดือน — ไม่เกินวันสุดท้ายของเดือน */
export function cutoffDayOf(config: ScorePeriodConfig, month: string): number {
  const [y, m] = parseMonth(month);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (config.calendarMonthsUntil && month <= config.calendarMonthsUntil) return lastDay;
  const day = config.overrides[month] ?? config.cutoffDay;
  return Math.min(Math.max(1, Math.round(day)), lastDay);
}

/** 00:00 เวลาไทยของวันที่ (y, m, d) เป็น Date (UTC) */
function bangkokMidnight(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d) - BANGKOK_OFFSET_MS);
}

/** ช่วงเวลาของรอบเกรดเดือน `month` — from รวม, to รวม (ถึง 23:59:59.999 ของวันตัดรอบ ตามเวลาไทย) */
export function scorePeriodRange(config: ScorePeriodConfig, month: string): { from: Date; to: Date } {
  const [y, m] = parseMonth(month);
  const prev = shiftPeriodMonth(month, -1);
  const [py, pm] = parseMonth(prev);
  const from = bangkokMidnight(py, pm, cutoffDayOf(config, prev) + 1);
  const to = new Date(bangkokMidnight(y, m, cutoffDayOf(config, month) + 1).getTime() - 1);
  return { from, to };
}

/** "YYYY-MM-DD" ตามเวลาไทยของเวลานั้น */
function bangkokDay(at: Date): string {
  return new Date(at.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

/** รอบเกรดเดือนไหนที่เวลานี้อยู่ */
export function scorePeriodOf(config: ScorePeriodConfig, at: Date): string {
  const day = bangkokDay(at);
  const month = day.slice(0, 7);
  return Number(day.slice(8, 10)) > cutoffDayOf(config, month) ? shiftPeriodMonth(month, 1) : month;
}

/** "26 ก.ย. – 25 ต.ค. 2569" */
export function scorePeriodLabel(config: ScorePeriodConfig, month: string): string {
  const { from, to } = scorePeriodRange(config, month);
  const f = bangkokDay(from);
  const t = bangkokDay(to);
  const fm = Number(f.slice(5, 7));
  const tm = Number(t.slice(5, 7));
  return `${Number(f.slice(8, 10))} ${THAI_MONTH[fm - 1]} – ${Number(t.slice(8, 10))} ${THAI_MONTH[tm - 1]} ${Number(t.slice(0, 4)) + 543}`;
}

/** อีกกี่วันถึงวันตัดรอบของรอบปัจจุบัน (0 = วันนี้คือวันตัดรอบ) */
export function daysUntilCutoff(config: ScorePeriodConfig, now: Date = new Date()): number {
  const month = scorePeriodOf(config, now);
  const [y, m] = parseMonth(month);
  const cutoff = Date.UTC(y, m - 1, cutoffDayOf(config, month));
  const today = Date.parse(`${bangkokDay(now)}T00:00:00Z`);
  return Math.round((cutoff - today) / 86_400_000);
}

/** เดือนจาก query param — ผิดรูปแบบ/อนาคตเกินรอบปัจจุบัน = รอบปัจจุบัน */
export function resolveScorePeriodParam(config: ScorePeriodConfig, param: string | undefined, now: Date = new Date()): string {
  const current = scorePeriodOf(config, now);
  return param !== undefined && /^\d{4}-(0[1-9]|1[0-2])$/.test(param) && param <= current ? param : current;
}

/** ค่าที่บันทึกไว้ (JSON) → config ที่ใช้ได้แน่ ๆ */
export function normalizeScorePeriodConfig(raw: unknown): ScorePeriodConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_SCORE_PERIOD;
  const value = raw as { cutoffDay?: unknown; overrides?: unknown };
  const cutoffDay =
    typeof value.cutoffDay === "number" && Number.isInteger(value.cutoffDay) && value.cutoffDay >= 1 && value.cutoffDay <= 31
      ? value.cutoffDay
      : DEFAULT_SCORE_PERIOD.cutoffDay;
  const overrides: Record<string, number> = {};
  if (value.overrides && typeof value.overrides === "object") {
    for (const [month, day] of Object.entries(value.overrides as Record<string, unknown>)) {
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 31) {
        overrides[month] = day;
      }
    }
  }
  const calendarMonthsUntil =
    typeof (value as { calendarMonthsUntil?: unknown }).calendarMonthsUntil === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test((value as { calendarMonthsUntil: string }).calendarMonthsUntil)
      ? (value as { calendarMonthsUntil: string }).calendarMonthsUntil
      : SCORE_PERIOD_STARTS_AFTER;
  return { cutoffDay, overrides, calendarMonthsUntil };
}

/**
 * รอบปิด (ล็อก) — 23:59:59 ของวันตัดรอบ (เวลาไทย) สำหรับทุกอย่างที่ "คน" ทำ (อนุมัติคำร้อง หัวหน้าหัก/คืน)
 * ต้องแก้ให้ทันก่อนนั้น ("ต้องแก้ให้ทันวันที่ 25 เวลา 23.59")
 *
 * ยกเว้นการตัดสินอัตโนมัติของระบบ (createdBy ว่าง) เผื่อถึง 23:59 วันถัดไป — กะดึกของวันตัดรอบเลิกวันถัดไป
 * หักได้หลังเลิกกะ + 2 ชม. (dockFinishedShifts) เช่น 22:00–08:00 หัก 10:59 · 22:00–10:00 หัก 12:59
 * ถ้าไม่เผื่อ กะดึกที่ขาดงานวันที่ 25 จะไม่โดนหักเลย
 * บริษัทที่ไม่มีกะดึก ทุกอย่างหักเสร็จก่อน 23:59 อยู่แล้ว ช่วงเผื่อนี้จึงไม่มีอะไรเกิด
 */
export const SYSTEM_JUDGEMENT_GRACE_MS = 24 * 60 * 60 * 1000;

/** เวลาปิดรอบสำหรับการแก้โดยคน */
export function scorePeriodCloseAt(config: ScorePeriodConfig, month: string): Date {
  return new Date(scorePeriodRange(config, month).to.getTime() + 1);
}

/** เวลาปิดรอบสำหรับการตัดสินอัตโนมัติของระบบ (หลังวันตัดรอบจบ + เผื่อรอบ 08:00) */
export function scorePeriodSystemCloseAt(config: ScorePeriodConfig, month: string): Date {
  return new Date(scorePeriodCloseAt(config, month).getTime() + SYSTEM_JUDGEMENT_GRACE_MS);
}

/**
 * คะแนนรายการนี้นับในรอบไหน — รอบของวันที่เกิดเรื่อง ถ้าบันทึกก่อนรอบนั้นปิด
 * บันทึกหลังปิด ⇒ null = ไม่นับที่ไหนเลย · ล็อกแล้วจบ ไม่ย้ายไปรอบใหม่ (เกรดรอบใหม่จะไม่ตรงกับที่ทำจริง ไม่แฟร์)
 * `createdBy` ว่าง = ระบบตัดสินเอง ได้เวลาเผื่อถึง scorePeriodSystemCloseAt
 */
export function effectiveScorePeriodOf(
  config: ScorePeriodConfig,
  occurredAt: Date,
  createdAt: Date | null | undefined,
  createdBy?: string | null,
): string | null {
  const own = scorePeriodOf(config, occurredAt);
  if (!createdAt) return own;
  const closeAt = createdBy ? scorePeriodCloseAt(config, own) : scorePeriodSystemCloseAt(config, own);
  return createdAt.getTime() >= closeAt.getTime() ? null : own;
}

/** รอบของวันนั้นปิดรับการแก้โดยคนแล้วหรือยัง (เลย 23:59 ของวันตัดรอบ) */
export function isScorePeriodClosed(config: ScorePeriodConfig, at: Date, now: Date = new Date()): boolean {
  return now.getTime() >= scorePeriodCloseAt(config, scorePeriodOf(config, at)).getTime();
}
