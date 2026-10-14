import { requireOrg } from "@smartboss/auth";

import { claimSweep, releaseSweep } from "@/modules/report_task/lib/server/sweep-throttle";
import { runReportPenaltySweep } from "@/modules/report_task/lib/server/report-penalty-sweep-run";

/**
 * หักคะแนน HR เมื่อพลาด/ส่งช้ารอบส่งรายงาน — ตัวงานอยู่ที่ report-penalty-sweep-run.ts
 * (cron ทุกชั่วโมงเรียกตัวเดียวกัน ไม่ต้องรอให้มีแท็บเปิดอยู่)
 */
export const dynamic = "force-dynamic";

// เผื่อ client ฝั่งไหนยิง GET แทน POST มา (เช่นเดียวกับ tasks/sweep, reminders/sweep)
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request?: Request) {
  const session = await requireOrg();
  // dryRun (ดูผลล่วงหน้าจากสคริปต์/แอดมิน) ไม่นับ ไม่ถูกข้าม
  if (request && new URL(request.url).searchParams.get("dryRun") === "1") {
    return runReportPenaltySweep(session.orgId, session.userId, request);
  }
  // ทุกแท็บสั่งทุก 60 วิ — รันจริงไม่เกิน 1 ครั้ง/30 วิ/บริษัท (ดู sweep-throttle.ts)
  if (!claimSweep("reports", session.orgId)) return Response.json({ ok: true, changed: false, throttled: true });
  try {
    return await runReportPenaltySweep(session.orgId, session.userId, request);
  } finally {
    releaseSweep("reports", session.orgId);
  }
}
