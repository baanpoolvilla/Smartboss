import "server-only";

import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { resolveActionNotifications } from "@/modules/maintenance/data/notify";

/**
 * คำขอแก้คะแนนของ "งานเลยกำหนด / ใบงานเกินกำหนด / ไม่ทำ PM ตามรอบ" (ผู้ใช้ขอ 21/10/2569)
 *
 * แยกจากคำร้องของรายงาน (report-penalty-requests — CEO อนุมัติคนเดียว + ขอส่งย้อนหลังได้) โดยตั้งใจ
 * ไม่ไปแก้ของเดิม: ที่นี่คนอนุมัติหลักคือ "เจ้าของเรื่อง" (คนสั่งงาน / คนเปิดใบงาน / คนสร้างแผน PM)
 * CEO อนุมัติแทนได้ทุกใบ แต่ได้แจ้งเตือนเฉพาะเมื่อไม่มีคนอื่นอนุมัติได้ (approverId = null)
 *
 * เก็บเป็น JSON array ใน report_task store (เหมือนคำร้องรายงาน — ไม่อยู่ใน whitelist ของ PUT ทั่วไป
 * เขียนได้เฉพาะผ่านโค้ดฝั่งเซิร์ฟเวอร์) · อนุมัติ = event ตรงข้าม `<refType>_undo` (lib/score-requests.ts)
 */

export const SCORE_REQUEST_CATEGORIES = ["task_late", "workorder_overdue", "pm_missed"] as const;
export type ScoreRequestCategory = (typeof SCORE_REQUEST_CATEGORIES)[number];

export type ScoreRequestStatus = "pending" | "approved" | "rejected" | "closed";

export interface ScoreRequest {
  id: string;
  /** คนที่โดนหัก */
  userId: string;
  /** คนยื่น (ปกติคนเดียวกับ userId — หัวหน้า/HR ยื่นแทนได้) */
  submittedBy: string;
  category: ScoreRequestCategory;
  /** event หักคะแนนต้นเรื่อง (core.performance_events) */
  eventId: string;
  source: string;
  refType: string;
  refId: string;
  /** แต้มที่หักไป (ติดลบ) — ณ ตอนยื่น */
  points: number;
  /** วันที่โดนหัก (YYYY-MM-DD เวลาไทย) — ใช้ตัดสินว่ารอบเกรดปิดหรือยัง */
  day: string;
  /** "Hidden น้ำรั่ว" — ข้อความของ event */
  title: string;
  target: { kind: "task" | "work_order" | "pm"; id: string; code: string | null };
  /** คนอนุมัติหลัก — null = ไม่มีคนอื่นอนุมัติได้ ⇒ แจ้ง CEO */
  approverId: string | null;
  approverRole: string;
  reasonTag: string;
  reason: string;
  status: ScoreRequestStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
  /** status "closed" — ปิดเองเพราะอะไร (ระบบคืนคะแนนให้แล้ว ฯลฯ) */
  closedReason?: string;
}

export const SCORE_REQUEST_KEY = "score-correction-requests";
/** ชนิดแจ้งเตือน (core.notifications.type) */
export const SCORE_REQ_PENDING = "score_req";
export const SCORE_REQ_DECIDED = "score_req_decided";
/** คำในหัวข้อแจ้งเตือนรออนุมัติ — ใช้เก็บกวาดตอนตัดสินแล้ว */
export const SCORE_REQ_PENDING_TITLE = "ขอแก้คะแนน รออนุมัติ";

export const SCORE_REASON_TAGS = [
  "รออะไหล่ / ของมาช้า",
  "ช่างภายนอกเลื่อนนัด",
  "ลูกบ้าน / ลูกค้าไม่สะดวกให้เข้า",
  "ฝนตก / สภาพอากาศ",
  "ระบบขัดข้อง / ตั้งกำหนดผิด",
  "อื่น ๆ",
] as const;

export async function listScoreRequests(orgId: string): Promise<ScoreRequest[]> {
  const { data } = await readStore<ScoreRequest[]>(orgId, SCORE_REQUEST_KEY);
  return data ?? [];
}

/**
 * อ่าน-แก้-เขียนแบบกันชน (เลขรุ่น) — `mutate` คืน null = ไม่ต้องเขียน
 * คืนผลของ mutate รอบที่เขียนสำเร็จ
 */
export async function updateScoreRequests<R>(
  orgId: string,
  actorId: string | undefined,
  mutate: (list: ScoreRequest[]) => { next: ScoreRequest[]; result: R } | null
): Promise<R | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, version } = await readStore<ScoreRequest[]>(orgId, SCORE_REQUEST_KEY);
    const out = mutate(data ?? []);
    if (!out) return null;
    const saved = await writeStore(orgId, SCORE_REQUEST_KEY, out.next, version, actorId);
    if (saved.ok) return out.result;
  }
  throw new Error("บันทึกไม่สำเร็จ มีคนแก้พร้อมกัน ลองใหม่อีกครั้ง");
}

/**
 * ปิดคำขอที่ค้างของรายการเหล่านี้ — ระบบคืนคะแนนให้เองแล้ว (เลื่อนกำหนด/ยกเลิกใบงาน/เจ้าของระบบยกเลิกการหัก ฯลฯ)
 * ไม่งั้นคนอนุมัติกดอนุมัติซ้ำ ได้คืนสองรอบ · แจ้งเตือน "รออนุมัติ" ของคำขอนั้นหายจากทุกคน
 */
export async function closePendingScoreRequests(
  orgId: string,
  refs: { category: string; refId: string }[],
  reason: string
): Promise<number> {
  if (refs.length === 0) return 0;
  const keys = new Set(refs.map((r) => `${r.category}|${r.refId}`));
  let closedIds: string[] = [];
  try {
    await updateScoreRequests(orgId, undefined, (list) => {
      const hits = list.filter((r) => r.status === "pending" && keys.has(`${r.category}|${r.refId}`));
      if (hits.length === 0) return null;
      closedIds = hits.map((r) => r.id);
      const at = new Date().toISOString();
      return {
        next: list.map((r) => (closedIds.includes(r.id) ? { ...r, status: "closed" as const, decidedAt: at, closedReason: reason } : r)),
        result: hits.length,
      };
    });
  } catch (err) {
    console.error("[score-requests] close pending failed", err);
    return 0;
  }
  for (const id of closedIds) await resolveActionNotifications(id, SCORE_REQ_PENDING, [SCORE_REQ_PENDING_TITLE]);
  return closedIds.length;
}
