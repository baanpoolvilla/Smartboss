import type { ChatApprovalInfo } from "../types";

/**
 * การ์ดคำขออนุมัติในห้อง "คำขออนุมัติ" (ผู้ใช้ 18/11/2569) — ส่วนที่ไม่แตะฐานข้อมูล ใช้ทั้งฝั่ง server และเครื่อง
 * สถานะบนการ์ดอ่านสดจากคำขอจริงทุกครั้ง (กดที่บอร์ด/หน้าใบงานก็เปลี่ยนตาม) — ดู data/approval-cards.ts
 */

export type ApprovalStatusPart = Pick<ChatApprovalInfo, "status" | "decidedBy" | "decidedAt" | "decisionNote">;

const STATUSES = new Set(["pending", "approved", "rejected", "cancelled"]);

/** สถานะคำขอเลื่อนของงาน จาก reportTask.data (dueDateRequests) — ไม่เจอ/ข้อมูลเพี้ยน = null */
export function taskRequestStatus(data: unknown, requestId: string): ApprovalStatusPart | null {
  if (!data || typeof data !== "object") return null;
  const list = (data as { dueDateRequests?: unknown }).dueDateRequests;
  if (!Array.isArray(list)) return null;
  const r = list.find((x) => x && typeof x === "object" && (x as { id?: unknown }).id === requestId) as Record<string, unknown> | undefined;
  if (!r || typeof r.status !== "string" || !STATUSES.has(r.status)) return null;
  return {
    status: r.status as ChatApprovalInfo["status"],
    ...(typeof r.decidedBy === "string" ? { decidedBy: r.decidedBy } : {}),
    ...(typeof r.decidedAt === "string" ? { decidedAt: r.decidedAt } : {}),
    ...(typeof r.decisionNote === "string" && r.decisionNote ? { decisionNote: r.decisionNote } : {}),
  };
}

const bkkDay = (v: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return Date.parse(`${v}T00:00:00Z`);
  const t = Date.parse(v);
  if (Number.isNaN(t)) return NaN;
  return Date.parse(`${new Date(t + 7 * 3600e3).toISOString().slice(0, 10)}T00:00:00Z`);
};

/** เลื่อนกี่วัน (ตามวันเวลาไทย) — วันไหนไม่มี = null */
export function daysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = bkkDay(from);
  const b = bkkDay(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}
