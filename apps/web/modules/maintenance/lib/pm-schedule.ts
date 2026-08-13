/**
 * ตรรกะวันกำหนด PM — port 1:1 จาก supabase_service.dart (nextDueSlot / _addMonthsClamped)
 * ยึด anchor เป็นหลัก ไม่ให้วันดริฟต์ตามวันจบงาน
 */

export interface PmFreq {
  value: string;
  label: string;
  months: number | null;
  weekDays: number | null;
}

export const PM_FREQUENCIES: PmFreq[] = [
  { value: "weekly", label: "1 สัปดาห์", months: null, weekDays: 7 },
  { value: "biweekly", label: "2 สัปดาห์", months: null, weekDays: 14 },
  { value: "triweekly", label: "3 สัปดาห์", months: null, weekDays: 21 },
  { value: "monthly", label: "1 เดือน", months: 1, weekDays: null },
  { value: "bimonthly", label: "2 เดือน", months: 2, weekDays: null },
  { value: "quarterly", label: "3 เดือน", months: 3, weekDays: null },
  { value: "month4", label: "4 เดือน", months: 4, weekDays: null },
  { value: "month5", label: "5 เดือน", months: 5, weekDays: null },
  { value: "semiannual", label: "6 เดือน", months: 6, weekDays: null },
  { value: "month7", label: "7 เดือน", months: 7, weekDays: null },
  { value: "month8", label: "8 เดือน", months: 8, weekDays: null },
  { value: "month9", label: "9 เดือน", months: 9, weekDays: null },
  { value: "month10", label: "10 เดือน", months: 10, weekDays: null },
  { value: "month11", label: "11 เดือน", months: 11, weekDays: null },
  { value: "annual", label: "12 เดือน", months: 12, weekDays: null },
];

const LEGACY: Record<string, string> = {
  triweekly: "triweekly",
};

function freq(value: string): PmFreq {
  const v = LEGACY[value] ?? value;
  return PM_FREQUENCIES.find((f) => f.value === v) ?? PM_FREQUENCIES[3]!; // monthly
}

export function freqLabel(value: string): string {
  return freq(value).label;
}
export function freqMonths(value: string): number | null {
  return freq(value).months;
}
export function freqWeekDays(value: string): number | null {
  return freq(value).weekDays;
}
/**
 * จำนวนรอบต่อปีสูงสุด = จำนวนช่องที่ยังตกอยู่ในปีเดียวกันนับจากวันตั้งต้น
 *
 * ⚠ ปัด **ขึ้น** ไม่ใช่ลง — ทุก 7 เดือนได้ช่องที่เดือน 0 กับ 7 = 2 รอบ ไม่ใช่ 1
 * ตอนปัดลงจะได้ 1 แล้วโดนเงื่อนไข "> 1" ตัดทิ้ง กลายเป็นเลือกอะไรไม่ได้เลย
 * (ความถี่แบบสัปดาห์ไม่ใช้ระบบรอบต่อปี จึงคืน 0)
 */
export function maxRoundsPerYear(value: string): number {
  const m = freq(value).months;
  if (m == null) return 0;
  return Math.ceil(12 / m);
}

/**
 * ตัวเลือก "ทำกี่รอบต่อปี" ที่ให้ผลต่างจากแบบทำต่อเนื่องจริง ๆ
 *
 * ถ้า 12 หารด้วยความถี่ลงตัว (ทุก 3 เดือน → 4 รอบ) การทำครบทุกช่องคือแบบ
 * ต่อเนื่องอยู่แล้ว จึงตัดตัวเลือกสุดท้ายออกไม่ให้มีสองทางที่ผลเหมือนกัน
 * แต่ถ้าหารไม่ลงตัว (ทุก 7 เดือน → 25/2, 25/9 แล้ววนกลับ 25/2 ปีหน้า)
 * รอบสุดท้ายยังต่างจากต่อเนื่อง จึงต้องเลือกได้
 */
export function roundsPerYearOptions(value: string): number[] {
  const m = freq(value).months;
  if (m == null || m >= 12) return [];
  const max = maxRoundsPerYear(value);
  const last = 12 % m === 0 ? max - 1 : max;
  return Array.from({ length: Math.max(0, last) }, (_, i) => i + 1);
}

const MS_PER_DAY = 86_400_000;

function dateOnlyUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function isAfter(a: Date, b: Date): boolean {
  return a.getTime() > b.getTime();
}

/** บวกเดือนโดยไม่ให้วันล้นเดือน (31/1 + 1 เดือน = 28/2) — port จาก _addMonthsClamped */
export function addMonthsClamped(d: Date, months: number): Date {
  const total = d.getUTCMonth() + months;
  const year = d.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12; // 0-based
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day));
}

/**
 * คืนช่องเวลา (วันกำหนด) แรกที่อยู่ "หลัง" after โดยยึด anchor
 * roundsPerYear = จำนวนรอบต่อปี (null/<=0 = ต่อเนื่อง)
 */
export function nextDueSlot(
  anchor: Date,
  frequency: string,
  roundsPerYear: number | null,
  after: Date
): Date {
  const a = dateOnlyUTC(anchor);
  const x = dateOnlyUTC(after);

  const wd = freqWeekDays(frequency);
  if (wd != null) {
    let next = a;
    let guard = 0;
    while (!isAfter(next, x) && guard++ < 10000) {
      next = new Date(next.getTime() + wd * MS_PER_DAY);
    }
    return next;
  }

  const months = freqMonths(frequency) ?? 1;

  if (roundsPerYear == null || roundsPerYear <= 0) {
    let next = a;
    let k = 0;
    while (!isAfter(next, x) && k < 10000) {
      k++;
      next = addMonthsClamped(a, months * k);
    }
    return next;
  }

  for (let c = 0; c < 200; c++) {
    for (let i = 0; i < roundsPerYear; i++) {
      const d = addMonthsClamped(a, c * 12 + i * months);
      if (isAfter(d, x)) return d;
    }
  }
  return addMonthsClamped(a, 12);
}

/** yyyy-mm-dd (UTC) สำหรับเก็บลง @db.Date */
export function toDateOnly(d: Date): Date {
  return dateOnlyUTC(d);
}

export type PmMode = "continuous" | "yearlyRounds" | "limitedCount";

export function pmMode(schedule: {
  totalRounds: number | null;
  roundsPerYear: number | null;
}): PmMode {
  if (schedule.totalRounds != null) return "limitedCount";
  if (schedule.roundsPerYear != null) return "yearlyRounds";
  return "continuous";
}

export const PM_MODE_LABEL: Record<PmMode, string> = {
  continuous: "ทำต่อเนื่อง",
  yearlyRounds: "ทำเป็นรอบต่อปี",
  limitedCount: "จำกัดจำนวนครั้ง",
};
