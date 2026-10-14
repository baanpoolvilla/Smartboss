/**
 * คำร้องขอแก้คะแนนเป็น "เดือนต่อเดือน" — ยื่นได้ถึงสิ้นเดือนที่โดนหักเท่านั้น ขึ้นเดือนใหม่ยอดเดือนเก่านิ่ง
 * (คำร้องที่ยื่นทันแล้วยังอนุมัติทีหลังได้ คืนคะแนนเข้าเดือนเดิม — ดู decidePenaltyRequest)
 *
 * ยกเว้น: รายการที่ระบบเพิ่งบันทึกในเดือนนี้ แม้เป็นของวันในเดือนก่อน (เช่น ไม่ส่งวันที่ 31 ซึ่งตัดสินได้
 * ตอนเช้าวันที่ 1) — ไม่งั้นคนนั้นไม่มีโอกาสยื่นเลย
 */

/** "YYYY-MM" ของตอนนี้ ตามเวลาไทย */
export function currentMonthBangkok(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

/** `day` = "YYYY-MM-DD" ของวันที่โดนหัก · `recordedAt` = ตอนที่ระบบบันทึกการหัก */
export function penaltyRequestOpen(day: string | null, recordedAt: Date | string | null, now: Date = new Date()): boolean {
  const month = currentMonthBangkok(now);
  if (day && day.slice(0, 7) === month) return true;
  if (recordedAt && currentMonthBangkok(new Date(recordedAt)) === month) return true;
  return false;
}
