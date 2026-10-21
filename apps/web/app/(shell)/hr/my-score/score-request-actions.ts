"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@smartboss/auth";

import { createScoreRequest, decideScoreRequest } from "@/lib/score-requests";

/**
 * คำขอแก้คะแนน งาน/ใบงาน/PM เลยกำหนด — คืน error เป็นข้อความ (ไม่ throw) เพราะ production
 * ซ่อนข้อความของ error จาก server action ผู้ใช้จะเห็นแค่ "เกิดข้อผิดพลาด" ไม่รู้ว่าทำไม
 */

function refresh(workOrderId?: string | null) {
  revalidatePath("/hr/my-score");
  revalidatePath("/hr/penalty-requests");
  if (workOrderId) revalidatePath(`/maintenance/work-orders/${workOrderId}`);
}

export async function createScoreRequestAction(input: {
  eventId: string;
  reasonTag: string;
  reason: string;
}): Promise<{ error?: string }> {
  const session = await requireOrg();
  const r = await createScoreRequest(session, input);
  if (r.error !== null) return { error: r.error };
  refresh(r.request.target.kind === "work_order" ? r.request.target.id : null);
  return {};
}

export async function decideScoreRequestAction(input: {
  id: string;
  decision: "approved" | "rejected";
  note?: string;
}): Promise<{ error?: string }> {
  const session = await requireOrg();
  const r = await decideScoreRequest(session, input);
  // ไม่ revalidate ตอนไม่ผ่าน — server action ที่ revalidate จะรีเฟรชหน้าทันที การ์ดหายไปพร้อมข้อความ
  if (r.error !== null) return { error: r.error };
  refresh(r.request.target.kind === "work_order" ? r.request.target.id : null);
  return {};
}
