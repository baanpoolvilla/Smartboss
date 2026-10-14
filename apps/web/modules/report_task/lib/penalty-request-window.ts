import { DEFAULT_SCORE_PERIOD, scorePeriodOf, type ScorePeriodConfig } from "@/lib/score-period";

/**
 * คำร้องขอแก้คะแนนเป็น "รอบต่อรอบ" — ยื่นได้ถึงวันตัดรอบของรอบเกรดที่โดนหัก (ปกติวันที่ 25 — score-period.ts)
 * พ้นวันตัดรอบแล้วยอดรอบนั้นนิ่ง (คำร้องที่ยื่นทันแล้วยังอนุมัติทีหลังได้ คืนคะแนนเข้าวันเดิม — decidePenaltyRequest)
 *
 * ยกเว้น: รายการที่ระบบเพิ่งบันทึกในรอบนี้ แม้เป็นของวันในรอบก่อน (เช่น ไม่ส่งวันที่ 25 ซึ่งตัดสินได้
 * ตอนเช้าวันที่ 26) — ไม่งั้นคนนั้นไม่มีโอกาสยื่นเลย
 */

/** `day` = "YYYY-MM-DD" ของวันที่โดนหัก · `recordedAt` = ตอนที่ระบบบันทึกการหัก */
export function penaltyRequestOpen(
  day: string | null,
  recordedAt: Date | string | null,
  period: ScorePeriodConfig = DEFAULT_SCORE_PERIOD,
  now: Date = new Date()
): boolean {
  const current = scorePeriodOf(period, now);
  // วันที่โดนหัก (เที่ยงวันเวลาไทย กันขอบวัน)
  if (day && scorePeriodOf(period, new Date(`${day}T12:00:00+07:00`)) === current) return true;
  if (recordedAt && scorePeriodOf(period, new Date(recordedAt)) === current) return true;
  return false;
}
