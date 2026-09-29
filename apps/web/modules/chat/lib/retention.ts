/**
 * อายุของรูป/วิดีโอ/ข้อความเสียงในแชท (แบบ LINE) — ครบกำหนดแล้วเปิดดูไม่ได้ ไฟล์ถูกลบทิ้ง
 * ประหยัดพื้นที่ ยกเว้นที่บันทึกลงอัลบั้มของห้อง (chat.album_items) ซึ่งเก็บถาวร
 *
 * ไม่มี "server-only" โดยตั้งใจ — หน้าเว็บใช้คำนวณป้าย "หมดอายุใน N วัน" ด้วยกติกาเดียวกับ
 * งานเก็บกวาดฝั่งเซิร์ฟเวอร์ (data/media-retention.ts) ตัวเลขสองฝั่งจึงตรงกันเสมอ
 *
 * เอกสาร (PDF/Excel/…) ไม่หมดอายุ — ไฟล์เล็ก และมักเป็นหลักฐานที่ต้องย้อนดู
 */

export const CHAT_MEDIA_RETENTION_DAYS = 30;

/**
 * เริ่มนับอายุจากวันนี้ (เวลาไทย) สำหรับไฟล์ที่ส่งก่อนเปิดใช้ฟีเจอร์ — ไม่งั้นคืนแรกที่งาน
 * เก็บกวาดรัน รูปเก่าทุกใบที่เกิน 30 วันหายพร้อมกันโดยไม่มีใครได้ทันบันทึกลงอัลบั้ม
 */
export const CHAT_MEDIA_RETENTION_START = "2026-10-01T00:00:00+07:00";

/** ชนิดไฟล์แนบที่หมดอายุ */
export const EXPIRING_KINDS = new Set(["image", "video", "audio"]);

const DAY_MS = 24 * 60 * 60 * 1000;

/** วันที่ไฟล์แนบของข้อความนี้หมดอายุ */
export function mediaExpiresAt(sentAt: Date | string): Date {
  const sent = new Date(sentAt).getTime();
  const start = new Date(CHAT_MEDIA_RETENTION_START).getTime();
  return new Date(Math.max(sent, start) + CHAT_MEDIA_RETENTION_DAYS * DAY_MS);
}

/** เหลืออีกกี่วัน (ปัดขึ้น) — 0 = หมดวันนี้ */
export function daysUntilExpiry(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / DAY_MS));
}
