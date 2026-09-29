import "server-only";
import { prisma } from "@smartboss/database";
import { crossOrg } from "@smartboss/database/cross-org";

import { bangkokDay, recalculateAttendanceAllOrgs } from "@/lib/attendance-recalc";
import { notifyUser } from "@/modules/maintenance/data/notify";
import { notifyApprovers } from "@/modules/hr/lib/hr-notify";

/**
 * แจ้งเตือนทันทีเมื่อมาสาย — แบบที่ระบบลงเวลาทั่วไปทำ (When I Work / "Late IN" alert)
 * รันถี่ ๆ ช่วงเช้าจาก cron (?task=late-alerts) · คะแนนยังหักรายวันตามเดิม (lib/attendance-performance.ts)
 *
 * ต่อรอบ: คำนวณผลลงเวลาของ "วันนี้" ให้ทุกคน (เบา — วันเดียว) แล้วหาใครที่สาย (สายหลังหักผ่อนผันของกะ
 * แล้ว > 0 นาที = ขึ้นป้าย "สาย" ในหน้าลงเวลา) ที่ยังไม่เคยแจ้ง แจ้ง:
 *   - ตัวพนักงาน   "คุณเข้างานสาย 8 นาที"                     (hr_late_self)
 *   - CEO / HR     "กระต่าย · เข้างานสาย 8 นาที"             (hr_late_team) — ทุกคนที่ถือสิทธิ์ดูการลงเวลา
 *                  ของทุกคน (workforce.attendance.read.all) ในระบบ HR ไม่แจ้งตัวเองถ้าคนสายถือสิทธิ์นี้เอง
 * กันแจ้งซ้ำด้วยแถวแจ้งเตือนเดิม (referenceId = "วันที่:userId") ⇒ วันละครั้งต่อคน รันซ้ำกี่รอบก็ได้
 * วันลา/วันหยุด ไม่แจ้ง (ฟังก์ชัน performance_attendance ตัดออกให้แล้ว)
 */

type LateRow = { user_id: string; work_date: Date; late_minutes: number };

export async function notifyLateArrivals(): Promise<{ late: number; notified: number }> {
  const today = bangkokDay(0);
  await recalculateAttendanceAllOrgs({ from: today, to: today }).catch((err) => {
    console.error("[late-alerts] recalc today failed", err);
  });

  // เกณฑ์ขาดงานสูงมากโดยตั้งใจ — วันนี้ยังไม่จบ absence ยังไม่นิ่ง ที่นี่สนแค่ late_minutes
  const rows = await prisma.$queryRaw<LateRow[]>`
    SELECT subject AS user_id, work_date, late_minutes
    FROM workforce.performance_attendance(${today}::date, 0, 1000000)
  `;
  const late = rows.filter((r) => new Date(r.work_date).toISOString().slice(0, 10) === today && Number(r.late_minutes) > 0);
  if (late.length === 0) return { late: 0, notified: 0 };

  const users = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.user.findMany({
      where: { id: { in: late.map((r) => r.user_id) }, isActive: true },
      select: { id: true, orgId: true },
    })
  );
  const userById = new Map(users.map((u) => [u.id, u]));

  const refs = late.map((r) => `${today}:${r.user_id}`);
  const already = new Set(
    (
      await crossOrg("cron:platform-job-resolves-org-per-row", () =>
        prisma.notification.findMany({
          where: { type: "hr_late_self", referenceId: { in: refs } },
          select: { referenceId: true },
        })
      )
    ).map((n) => n.referenceId)
  );

  let notified = 0;
  for (const r of late) {
    const user = userById.get(r.user_id);
    if (!user?.orgId) continue;
    const ref = `${today}:${user.id}`;
    if (already.has(ref)) continue;
    const minutes = Number(r.late_minutes);

    await notifyUser(user.orgId, user.id, {
      title: `คุณเข้างานสาย ${minutes} นาที`,
      body: "นับหลังหักเวลาผ่อนผันของกะแล้ว · ถ้าลืมสแกนหรือมีเหตุจำเป็น ยื่นคำขอแก้เวลาได้ที่หน้าบุคคล",
      type: "hr_late_self",
      referenceId: ref,
    });

    // notifyApprovers ใส่ชื่อคนสายนำหน้าหัวข้อให้เอง และข้ามตัวคนสาย
    await notifyApprovers(user.orgId, "workforce.attendance.read.all", user.id, {
      title: `เข้างานสาย ${minutes} นาที`,
      body: "นับหลังหักเวลาผ่อนผันของกะแล้ว",
      type: "hr_late_team",
      referenceId: ref,
    });
    notified++;
  }
  return { late: late.length, notified };
}
