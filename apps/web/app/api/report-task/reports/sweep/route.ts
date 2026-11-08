import { requireOrg } from "@smartboss/auth";

import { claimSweep, releaseSweep } from "@/modules/report_task/lib/server/sweep-throttle";
import { runReportPenaltySweep } from "@/modules/report_task/lib/server/report-penalty-sweep-run";
import { crossedClockBoundary, reportSweepInputs } from "@/modules/report_task/lib/server/report-sweep-inputs";

/**
 * รันจริงเมื่อมีเหตุให้ผลเปลี่ยนเท่านั้น (เดิมรันทุก 30 วิทั้งวัน รอบละ ~1.5 วิ บน prod — 8/11/2569):
 *   - สิ่งที่ตัวหักคะแนนใช้เปลี่ยน: โพสต์/ห้อง/ตั้งค่า/คำร้อง/ใบลา/OT/วันหยุด (report-sweep-inputs.ts)
 *     — การอ่าน ตอบ กดสติกเกอร์ไม่นับ
 *   - เพิ่งเลยเวลาปิดรอบ/ปิดรับของห้องใดห้องหนึ่ง หรือขึ้นวันใหม่
 *   - ไม่มีอะไรเลย ก็ยังรันทุก 5 นาทีกันพลาด
 * ทั้งหมดยังไม่ถี่กว่า 30 วิ/บริษัทเหมือนเดิม (sweep-throttle.ts) · cron รายชั่วโมงเรียกตัวงานตรง ไม่ผ่านตรงนี้
 */
const IDLE_SWEEP_MS = 5 * 60_000;
const g = globalThis as unknown as { __reportSweepLast?: Map<string, { at: number; input: string }> };
const lastRun = (g.__reportSweepLast ??= new Map());

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
  const { key: input, times } = await reportSweepInputs(session.orgId);
  const last = lastRun.get(session.orgId);
  if (last && last.input === input && Date.now() - last.at < IDLE_SWEEP_MS && !crossedClockBoundary(times, last.at)) {
    return Response.json({ ok: true, changed: false, throttled: true });
  }
  if (!claimSweep("reports", session.orgId)) return Response.json({ ok: true, changed: false, throttled: true });
  try {
    const res = await runReportPenaltySweep(session.orgId, session.userId, request);
    // จำหลังรัน (ตัวงานอาจเขียนฟีดเอง เช่น ทำเครื่องหมายส่งย้อนหลังแล้ว)
    if (res.ok) lastRun.set(session.orgId, { at: Date.now(), input: (await reportSweepInputs(session.orgId)).key });
    return res;
  } finally {
    releaseSweep("reports", session.orgId);
  }
}
