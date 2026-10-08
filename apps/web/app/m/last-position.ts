/**
 * ตำแหน่งล่าสุดที่หน้านี้เพิ่งหาได้ (แผนที่บนจอ) — ให้ปุ่มลงเวลาใช้ต่อได้เลย ไม่ต้องขอ GPS ซ้ำ
 *
 * เดิมเปิดหน้าลงเวลา = แผนที่ขอตำแหน่ง 1 ครั้ง แล้วกดปุ่มขอใหม่อีก 1–2 ครั้ง บน iPhone แต่ละครั้งอาจเด้ง
 * ถามอนุญาต ("ทำไมถามอนุญาต gps บ่อยจัง") · อายุไม่เกิน 1 นาที = เกณฑ์เดียวกับทางสำรองของ getPosition
 * ใน today.tsx ที่ยอมรับตำแหน่งที่เครื่องเพิ่งหาไว้อยู่แล้ว — ฝั่งระบบบุคคลยังตรวจระยะ/ความแม่นเหมือนเดิม
 */
const MAX_AGE_MS = 60_000;

let last: { position: GeolocationPosition; at: number } | null = null;

export function rememberPosition(position: GeolocationPosition): void {
  last = { position, at: Date.now() };
}

export function recentPosition(): GeolocationPosition | null {
  return last && Date.now() - last.at <= MAX_AGE_MS ? last.position : null;
}
