/**
 * คำอธิบายธงความเสี่ยงของการลงเวลาจากมือถือ — ใช้ทั้งหน้าลงเวลา (app/m/today.tsx, แอป + LINE)
 * และหน้าคิวตรวจของ HR (/hr/checkin-review) ให้พูดภาษาเดียวกัน
 *
 * คีย์ต้องตรงกับ RiskFlag ของตัวตัดสินจริง (packages/workforce/domain/src/attendance/photo-policy.ts)
 * — เดิมหน้าลงเวลาใช้ชื่อเดา (GEOFENCE_OUTSIDE, MOCK_LOCATION, NOT_LIVE_CAPTURE) ที่ไม่มีอยู่จริง
 * คนที่อยู่นอกเขตเลยเห็นรหัสดิบ "LOCATION_OUTSIDE_RADIUS" แทนคำอธิบาย
 */
export const CHECKIN_FLAG_LABEL: Record<string, string> = {
  LOCATION_MISSING: "ไม่ได้ส่งตำแหน่งมาด้วย (หรือยังไม่ได้ตั้งสถานที่ทำงาน)",
  LOCATION_OUTSIDE_RADIUS: "อยู่นอกบริเวณสถานที่ทำงาน",
  LOCATION_ACCURACY_POOR: "สัญญาณตำแหน่งไม่แม่นพอ ลองออกไปที่โล่งแล้วลองใหม่",
  MOCK_LOCATION_SUSPECTED: "ตรวจพบการปลอมตำแหน่ง",
  PHOTO_MISSING: "ไม่มีรูปประกอบ",
  PHOTO_NOT_LIVE_CAPTURE: "รูปไม่ได้ถ่ายสด",
  PHOTO_DUPLICATE: "รูปซ้ำกับที่เคยส่งแล้ว",
  // เจอบ่อยสุดกับคนที่ยังไม่ถูกจัดเข้ากลุ่มนโยบาย (นโยบายตั้งต้นของระบบบุคคลบังคับเครื่องที่อนุมัติแล้ว)
  DEVICE_NOT_ENROLLED: "เครื่องนี้ยังไม่ได้รับอนุมัติ — แจ้ง HR ให้จัดคุณเข้ากลุ่มนโยบายลงเวลา",
  DEVICE_ATTESTATION_FAILED: "ตรวจสอบเครื่องไม่ผ่าน",
  CAPTURE_DEADLINE_EXCEEDED: "ส่งช้าเกินเวลาที่กำหนด",
  OFFLINE_TOO_OLD: "ข้อมูลที่บันทึกไว้ตอนออฟไลน์เก่าเกินไป",
  IMPOSSIBLE_TRAVEL: "ตำแหน่งเปลี่ยนเร็วผิดปกติจากครั้งก่อน",
  RAPID_REPEAT_CHECKIN: "กดลงเวลาซ้ำติดกันเร็วเกินไป",
  CLOCK_SKEW: "เวลาในเครื่องคลาดจากเวลาจริง",
};

export function checkinFlagLabel(flag: string): string {
  return CHECKIN_FLAG_LABEL[flag] ?? flag;
}
