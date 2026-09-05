/**
 * วันที่ตามปฏิทินของเครื่องที่รัน ไม่ใช่ของ UTC
 *
 * `new Date().toISOString().slice(0, 10)` ให้วันที่แบบ UTC — เซิร์ฟเวอร์ตั้ง
 * TZ=Asia/Bangkok (ดู deploy/systemd/smartboss-web.service) ⇒ ตั้งแต่เที่ยงคืน
 * ถึงเจ็ดโมงเช้าตามเวลาไทย ค่านั้นยังเป็น "เมื่อวาน" อยู่ ปฏิทินวันหยุดจึงไป
 * ไฮไลต์ผิดวัน และเดือนตั้งต้นเพี้ยนได้ในวันที่ 1 ของเดือน
 */
export function localDateStr(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** วันนี้ในรูปแบบ YYYY-MM-DD ตามเวลาท้องถิ่น */
export function todayIso(): string {
  return localDateStr(new Date());
}

/** เดือนปัจจุบันในรูปแบบ YYYY-MM ตามเวลาท้องถิ่น */
export function currentMonth(): string {
  return todayIso().slice(0, 7);
}

const THAI_MONTH_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/** "2026-09-05" → "5 ก.ย." — ใช้ในข้อความสั้น ๆ ที่วันที่ล้วนอ่านยาก */
export function thaiShortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  const index = Number(month) - 1;
  if (day === undefined || THAI_MONTH_SHORT[index] === undefined) return iso;
  return `${Number(day)} ${THAI_MONTH_SHORT[index]}`;
}
