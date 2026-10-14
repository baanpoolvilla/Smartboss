import { requireOrg } from "@smartboss/auth";

import { claimSweep, releaseSweep } from "@/modules/report_task/lib/server/sweep-throttle";
import { runTaskPenaltySweep } from "@/modules/report_task/lib/server/task-penalty-sweep-run";

/**
 * หักคะแนนงานที่เลยกำหนด — ตัวงานอยู่ที่ task-penalty-sweep-run.ts
 * TaskSync ยังเป็นตัวกระตุ้น (ตอนโหลด + ทุก 60 วิ) และ cron ทุกชั่วโมงเรียกตัวเดียวกัน
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return POST();
}

export async function POST() {
  const session = await requireOrg();
  // ทุกแท็บสั่งทุก 60 วิ — รันจริงไม่เกิน 1 ครั้ง/30 วิ/บริษัท (ดู sweep-throttle.ts)
  if (!claimSweep("tasks", session.orgId)) return Response.json({ ok: true, changed: false, throttled: true });
  try {
    return await runTaskPenaltySweep(session.orgId, session.userId);
  } finally {
    releaseSweep("tasks", session.orgId);
  }
}
