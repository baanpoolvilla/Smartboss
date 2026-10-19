import type { DueDateRequest } from "@/modules/report_task/types";

/** ข้อความเดียวกับ requestDueDateChange (task-store.ts) — `X ขอเลื่อนกำหนดส่งงาน "…" จาก … เป็น …` */
const REQUEST_PHRASE = "ขอเลื่อนกำหนดส่งงาน";
/** แจ้งเตือนสร้างในจังหวะเดียวกับคำขอ (ห่างกันไม่กี่มิลลิวินาที) — เผื่อไว้ 1 นาที */
const MATCH_WINDOW_MS = 60_000;

interface NotifShape {
  kind?: string;
  message: string;
  byUserId: string;
  createdAt: string;
}

/**
 * แจ้งเตือน "ขอเลื่อนกำหนดส่ง" ที่ส่งถึงผู้อนุมัติ ของคำขอที่ถูกถอนไปแล้ว ⇒ ไม่แสดงในกระดิ่ง
 * ผู้ใช้ขอ 19/10/2569 "ลบคำขอเลื่อนต้องลบแจ้งเตือนออกไปด้วย มันจะซ้ำซ้อน":
 *   - คนขอยกเลิกเอง (status "cancelled")
 *   - คนขอส่งคำขอใหม่แทน (คำขอเดิมหายจากรายการ — requestDueDateChange เก็บแค่อันล่าสุดที่ค้าง)
 * จับคู่แจ้งเตือนกับคำขอด้วย "คนขอ + เวลาที่ขอ" · คำขอที่อนุมัติ/ไม่อนุมัติแล้วยังแสดง (เป็นประวัติ)
 * แจ้งเตือนเก็บแยกรายคน เครื่องหนึ่งลบของคนอื่นไม่ได้ จึงซ่อนตอนแสดงผลแทน (self-heal ของเก่าด้วย)
 */
export function isWithdrawnDueRequestNotification(n: NotifShape, requests: readonly DueDateRequest[] | undefined): boolean {
  if (n.kind !== "task_due_request" || !n.message.includes(REQUEST_PHRASE)) return false;
  const t = Date.parse(n.createdAt);
  if (!Number.isFinite(t)) return false;
  const match = (requests ?? []).find(
    (r) => r.requestedBy === n.byUserId && Math.abs(Date.parse(r.requestedAt) - t) <= MATCH_WINDOW_MS
  );
  return !match || match.status === "cancelled";
}
