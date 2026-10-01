/**
 * วันที่กำหนดส่ง/นัดรอบ PM ห้ามอยู่ในอดีต — ตั้งย้อนหลังแล้ว cron (data/cron.ts) เห็นว่า
 * "เลยกำหนด" ทันทีแล้วหักคะแนนผู้รับผิดชอบ ทั้งที่ไม่เคยมีโอกาสทำทัน
 * (เคสเดียวกับงาน report-task ที่ขอเลื่อน 30/09 → 04/09 ตั้งใจ 04/10)
 */

/** วันนี้ตามเวลาไทย เป็น YYYY-MM-DD (ใช้เป็น min ของ <input type="date"> ได้ตรง ๆ) */
export function todayBangkok(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(now);
}

/** "YYYY-MM-DD" อยู่ก่อนวันนี้ (เวลาไทย) ไหม */
export function isPastDay(ymd: string, now: Date = new Date()): boolean {
  return ymd.slice(0, 10) < todayBangkok(now);
}
