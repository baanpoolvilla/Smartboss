import { DEFAULT_SCORE_PERIOD, isScorePeriodClosed, scorePeriodCloseAt, scorePeriodOf, type ScorePeriodConfig } from "@/lib/score-period";

/**
 * คำร้องขอแก้คะแนน — ยื่น/อนุมัติได้จนรอบเกรดของวันที่โดนหักปิด (23:59 ของวันตัดรอบ — score-period.ts)
 * ล็อกแล้วจบ: เลยแล้วยื่นไม่ได้ อนุมัติไม่ได้ ไม่มีการย้ายไปปรับรอบถัดไป
 */
export function penaltyRequestOpen(
  day: string | null,
  period: ScorePeriodConfig = DEFAULT_SCORE_PERIOD,
  now: Date = new Date()
): boolean {
  if (!day) return false;
  // เที่ยงวันเวลาไทยของวันนั้น กันขอบวัน
  return !isScorePeriodClosed(period, new Date(`${day}T12:00:00+07:00`), now);
}

/** ส่งรีพอตย้อนหลังของวัน `day` (หลัง CEO อนุมัติ) ได้ถึงเมื่อไหร่ — 23:59 วันตัดรอบเกรดของรอบที่วันนั้นอยู่ */
export function retroSubmitDeadline(day: string, period: ScorePeriodConfig = DEFAULT_SCORE_PERIOD): Date {
  return scorePeriodCloseAt(period, scorePeriodOf(period, new Date(`${day}T12:00:00+07:00`)));
}
