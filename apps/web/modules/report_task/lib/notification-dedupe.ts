/**
 * กันแจ้งเตือนเบิ้ล — ใช้ทั้งบนเครื่อง (notification-store) และตอนเซิร์ฟเวอร์รวมแจ้งเตือน (org-store writeOwnNotifications)
 *
 * แจ้งเตือน "ซ้ำ" = ผู้รับเดียวกัน คนทำคนเดียวกัน ข้อความเดียวกันทุกตัวอักษร ภายในช่วงเวลา:
 *   - ความคิดเห็น / ไฟล์แนบ / โพสต์ในห้อง: 5 วินาที — พิมพ์ "ok" สองครั้งคือสองข้อความจริง ห้ามรวม
 *   - เหตุการณ์ของงาน (ส่งงาน รอตรวจ, ติ๊กเช็คลิสต์, มอบหมาย, เปลี่ยนสถานะ …): 10 นาที
 * เคสจริง 19/10/2569: ติ๊ก "เก็บเงินได้แล้ว" ซ้ำห่างกัน 5.5 วินาที (เลยเพดานเดิม 5 วินาทีไปนิดเดียว)
 * CEO และผู้ตรวจได้ "ส่งงาน … รอคุณตรวจ" + "ทำ … ในเช็คลิสต์" มาเป็นคู่
 */
export const SHORT_DUPLICATE_WINDOW_MS = 5_000;
export const EVENT_DUPLICATE_WINDOW_MS = 10 * 60_000;

const CONVERSATION_KINDS = new Set(["task_comment", "task_attachment", "room_post"]);

export function duplicateWindowFor(kind: unknown): number {
  return typeof kind === "string" && CONVERSATION_KINDS.has(kind) ? SHORT_DUPLICATE_WINDOW_MS : EVENT_DUPLICATE_WINDOW_MS;
}

interface DedupeShape {
  userId?: unknown;
  byUserId?: unknown;
  message?: unknown;
  kind?: unknown;
  createdAt?: unknown;
}

/** `n` ซ้ำกับรายการใดใน `list` ไหม (เทียบเวลาจาก createdAt ของทั้งคู่ — ไม่สนลำดับ) */
export function isDuplicateNotification(list: readonly DedupeShape[], n: DedupeShape): boolean {
  const t = Date.parse(String(n.createdAt ?? ""));
  if (!Number.isFinite(t)) return false;
  const windowMs = duplicateWindowFor(n.kind);
  for (const x of list) {
    if (x === n) continue;
    if (x.userId !== n.userId || x.byUserId !== n.byUserId || x.message !== n.message) continue;
    const tx = Date.parse(String(x.createdAt ?? ""));
    if (Number.isFinite(tx) && Math.abs(t - tx) <= windowMs) return true;
  }
  return false;
}

/** ตัดตัวซ้ำออกจากชุดที่เพิ่งเข้ามา — เทียบกับของที่มีอยู่แล้ว และกันซ้ำกันเองในชุดเดียวกัน (เก็บตัวแรก) */
export function dropDuplicateNotifications<T extends DedupeShape>(incoming: readonly T[], existing: readonly DedupeShape[]): T[] {
  const kept: T[] = [];
  for (const n of incoming) {
    if (isDuplicateNotification(existing, n) || isDuplicateNotification(kept, n)) continue;
    kept.push(n);
  }
  return kept;
}
