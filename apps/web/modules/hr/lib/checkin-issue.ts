/**
 * ปุ่ม "ลงเวลาไม่ได้? แจ้งไอที" บนหน้าลงเวลา (app/m/today.tsx) — ปัญหาที่ให้เลือก
 *
 * แยกไฟล์ (ไม่มี server-only) ให้ทั้งหน้าจอกับ API ใช้รายการเดียวกัน
 */
export const CHECKIN_PROBLEMS = {
  gps_denied: "GPS ไม่ขึ้น / ไม่ได้รับตำแหน่ง",
  gps_inaccurate: "GPS ไม่แม่น ขึ้นว่าคลาดเคลื่อนเกิน",
  outside_area: "อยู่ที่ทำงานแล้ว แต่ระบบบอกว่าอยู่นอกพื้นที่",
  photo: "ถ่ายรูปไม่ได้ / กล้องไม่เปิด",
  button_error: "กดแล้วขึ้น error / ค้าง",
  other: "อื่น ๆ",
} as const;

export type CheckinProblem = keyof typeof CHECKIN_PROBLEMS;

/** เดาปัญหาจากข้อความที่หน้าลงเวลาเพิ่งขึ้น (ข้อความจาก api/m/checkin gpsGate) — คนแจ้งเปลี่ยนเองได้ */
export function guessCheckinProblem(lastMessage: string | null): CheckinProblem {
  if (!lastMessage) return "other";
  if (lastMessage.includes("ไม่ได้รับตำแหน่ง") || lastMessage.includes("อนุญาตตำแหน่ง")) return "gps_denied";
  if (lastMessage.includes("ไม่แม่น")) return "gps_inaccurate";
  if (lastMessage.includes("ห่าง") || lastMessage.includes("นอก")) return "outside_area";
  if (lastMessage.includes("รูป") || lastMessage.includes("กล้อง")) return "photo";
  return "button_error";
}
