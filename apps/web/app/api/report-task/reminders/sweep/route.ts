import { requireOrg } from "@smartboss/auth";

import { runReminderSweep } from "@/modules/report_task/lib/server/reminder-sweep-run";
import { claimSweep, releaseSweep } from "@/modules/report_task/lib/server/sweep-throttle";

/**
 * แจ้งเตือน "ใกล้ถึงกำหนด" (งาน/ประชุม/รอบส่งรีพอต) — คนละงานกับ
 * tasks/sweep (ที่หักคะแนนงานที่ "เลยกำหนดไปแล้ว") ไฟล์นี้มองไปข้างหน้า
 * ไม่ใช่ย้อนหลัง จึงแยก route ต่างหากแทนที่จะยัดเข้า sweep เดิม
 *
 * เรียกจากฝั่ง client เหมือน tasks/sweep เป๊ะๆ (ดู task-sync.tsx) — ทริกเกอร์
 * ทุก 60 วิระหว่างมีแท็บเปิดอยู่ · ฝั่งเซิร์ฟเวอร์รันตัวเดียวกันทุกนาทีผ่าน
 * /api/cron/maintenance (พ่วงกับ task=attendance-chat) (ไม่ต้องรอให้มีคนเปิดเว็บ — เตือนเช้าตรงเวลา)
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return POST();
}

export async function POST() {
  const session = await requireOrg();
  // ทุกแท็บสั่งทุก 60 วิ — รันจริงไม่เกิน 1 ครั้ง/30 วิ/บริษัท (ดู sweep-throttle.ts)
  if (!claimSweep("reminders", session.orgId)) return Response.json({ ok: true, sent: 0, throttled: true });
  try {
    return Response.json(await runReminderSweep(session.orgId, session.userId));
  } finally {
    releaseSweep("reminders", session.orgId);
  }
}
