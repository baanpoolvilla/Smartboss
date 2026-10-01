import "server-only";

/**
 * กันรอบตรวจทั้งบริษัท (tasks / reminders / reports sweep) ไม่ให้รันซ้ำถี่เกินไป
 *
 * ทุกแท็บที่เปิดอยู่สั่งรอบตรวจทุก 60 วินาที (task-sync.tsx) — ผลเหมือนกันไม่ว่าใคร
 * สั่ง แต่แต่ละครั้งอ่านฟีดรายงาน/งานทั้งก้อนและคิดคะแนนใหม่ทั้งบริษัท เปิดอยู่ 20 แท็บ
 * = งานหนักซ้ำ ๆ 60 ครั้งต่อนาที บนเครื่อง 2 คอร์ที่ใช้ร่วมกับ workforce API
 * (CPU เต็ม เว็บค้าง/502 — 2026-10-01)
 *
 * เก็บในหน่วยความจำของ process (เว็บรันตัวเดียว) — รีสตาร์ทแล้วเริ่มนับใหม่ ไม่เป็นไร
 * คนที่ถูกข้ามไม่เสียอะไร: ผลของรอบที่เพิ่งรันถูกบันทึกแล้ว แท็บอื่นเห็นผ่าน poll ปกติ
 */
const lastRun = new Map<string, number>();
const running = new Set<string>();

/** true = ให้รันได้ (จองไว้แล้ว ต้องเรียก `release` ตอนจบ) · false = เพิ่งรัน/กำลังรันอยู่ ข้ามได้ */
export function claimSweep(name: string, orgId: string, minIntervalMs = 30_000): boolean {
  const key = `${name}:${orgId}`;
  if (running.has(key)) return false;
  const last = lastRun.get(key);
  if (last !== undefined && Date.now() - last < minIntervalMs) return false;
  running.add(key);
  lastRun.set(key, Date.now());
  return true;
}

export function releaseSweep(name: string, orgId: string): void {
  running.delete(`${name}:${orgId}`);
}
