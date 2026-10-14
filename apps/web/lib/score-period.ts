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
  /**
   * เวลาเลิกกะที่ช้าที่สุดของบริษัท (นาทีจากเที่ยงคืนของวันทำงาน · เกิน 1440 = เลิกวันถัดไป) — ไม่ได้เก็บใน store
   * loadScorePeriodConfig อ่านจากกะที่ HR ตั้งไว้ให้ทุกครั้ง · ใช้หาเวลาพร้อมใช้/ปิดรับของระบบ (scorePeriodReadyAt)
   */
  latestShiftEndMinutes?: number | null;
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
 * การตัดสินอัตโนมัติของระบบ (createdBy ว่าง) ของวันตัดรอบเกิดหลังเที่ยงคืนได้ — ไม่ส่งรายงานวันที่ 25 เปลี่ยนจาก
 * "ส่งช้า −1" เป็น "ไม่ส่ง −2" ตอนวันที่ 25 จบ · งานครบกำหนด 23:59 รู้ว่าเลยหลังเที่ยงคืน · กะดึกหักหลังเลิกกะ 2 ชม.
 * ⇒ ระบบนับถึง "เวลาพร้อมใช้" (scorePeriodReadyAt) พอดี — หลังจากนั้นไม่มีอะไรเปลี่ยนอีกทั้งคนและระบบ
 * (เวลาที่บอก HR ว่าพร้อมใช้ = เวลาที่ตัวเลขนิ่งจริง) · ไม่เกิน SYSTEM_JUDGEMENT_GRACE_MS หลังปิดรอบ
 */
export const SYSTEM_JUDGEMENT_GRACE_MS = 24 * 60 * 60 * 1000;

/** เวลาปิดรอบสำหรับการแก้โดยคน */
export function scorePeriodCloseAt(config: ScorePeriodConfig, month: string): Date {
  return new Date(scorePeriodRange(config, month).to.getTime() + 1);
}

/** เวลาปิดรอบสำหรับการตัดสินอัตโนมัติของระบบ = เวลาพร้อมใช้ */
export function scorePeriodSystemCloseAt(config: ScorePeriodConfig, month: string): Date {
  return scorePeriodReadyAt(config, month);
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

/** รอคะแนนลงเวลานิ่งหลังเลิกกะกี่ ms ก่อนหัก — ต้องตรงกับ SHIFT_SETTLE_MS ใน attendance-performance.ts */
export const SHIFT_SETTLE_FOR_READY_MS = 2 * 60 * 60 * 1000;

/** รอบเก็บตกของวันตัดรอบ (cron task=score-final 00:05) ทำเสร็จแน่ภายในกี่ ms หลังเที่ยงคืน */
export const FINAL_RUN_DONE_MS = 30 * 60 * 1000;

/**
 * เกรดของรอบ `month` พร้อมใช้ (นิ่ง เอาไปคิดเงินเดือนได้) ตอนไหน — หลังระบบตัดสินของวันตัดรอบครบ
 * `latestShiftEndMinutes` (ค่าเริ่มต้นจาก config) = เวลาเลิกกะที่ช้าที่สุดของบริษัท นับเป็นนาทีจากเที่ยงคืนของวันทำงาน
 * (shift_definitions.end_minutes · เกิน 1440 = เลิกวันถัดไป) · null = ไม่มีกะ
 *   - ทุกบริษัท: รอบเก็บตก 00:05 (งานเลยกำหนด/ไม่ส่งรายงานของวันตัดรอบ + คืนคะแนนใบลาที่อนุมัติทัน) ⇒ 00:30
 *   - กะเลิกช้าสุด + 2 ชม. เลยเที่ยงคืน (กะดึก หรือกะเลิกดึกอย่าง 23:00): รอบ :59 แรกหลังจากนั้น ⇒ +31 นาที
 *     เช่น 22:00–08:00 หัก 10:59 ⇒ 11:30 · ไม่เกิน SYSTEM_JUDGEMENT_GRACE_MS
 */
export function scorePeriodReadyAt(
  config: ScorePeriodConfig,
  month: string,
  latestShiftEndMinutes: number | null = config.latestShiftEndMinutes ?? null,
): Date {
  const lockAt = scorePeriodCloseAt(config, month).getTime(); // 00:00 วันถัดจากวันตัดรอบ (เวลาไทย)
  let ready = lockAt + FINAL_RUN_DONE_MS;
  if (latestShiftEndMinutes !== null) {
    const settle = lockAt - 86_400_000 + latestShiftEndMinutes * 60_000 + SHIFT_SETTLE_FOR_READY_MS;
    // รอบ cron ที่นาที :59 แรกที่ไม่ก่อน settle แล้วรอให้รอบนั้นทำเสร็จ (ปัดเป็น :30)
    const hour = 3_600_000;
    const run = Math.ceil((settle - 59 * 60_000) / hour) * hour + 59 * 60_000;
    ready = Math.max(ready, run + 31 * 60_000);
  }
  return new Date(Math.min(ready, lockAt + SYSTEM_JUDGEMENT_GRACE_MS));
}

/**
 * วันสุดท้ายที่ส่งรายงานย้อนหลังได้ (รอบรายสัปดาห์/รายเดือน) — ไม่เลยวันตัดรอบของรอบที่วันครบกำหนดอยู่
 * ("ตัดรอบส่งช้าได้ 23.59 ถ้าไม่ส่งเท่ากับขาดส่งเลย") ⇒ ครบกำหนด 24 ส่งย้อนหลัง 3 วัน = ส่งได้ถึง 25 (ไม่ใช่ 27)
 * ไม่ส่งภายใน 23:59 วันที่ 25 = ไม่ส่ง −2 ตัดสินรอบเก็บตก 00:05 ทันนับในเกรดรอบนั้น · ส่งหลังจากนั้นไม่นับเป็นส่งช้า
 * `config` null (ยังโหลดไม่เสร็จ) = ไม่ตัด
 */
export function graceEndWithinPeriod(config: ScorePeriodConfig | null | undefined, dueDay: string, graceEndDay: string): string {
  if (!config) return graceEndDay;
  const month = scorePeriodOf(config, new Date(`${dueDay}T12:00:00+07:00`));
  const lastDay = bangkokDay(scorePeriodRange(config, month).to);
  return graceEndDay > lastDay ? lastDay : graceEndDay;
}

/** ถึงเวลานี้แล้วหรือยัง (ใช้ในหน้า server component — เลี่ยงเรียก Date.now() ตรงตอน render) */
export function hasPassed(at: Date, now: Date = new Date()): boolean {
  return now.getTime() >= at.getTime();
}
