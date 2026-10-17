import "server-only";
import { randomUUID } from "node:crypto";

import { prisma } from "@smartboss/database";
import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { bangkokToday } from "@/modules/report_task/lib/task-recurrence";
import type { AppNotification } from "@/modules/report_task/store/notification-store";
import type { Project } from "@/modules/report_task/types";

/**
 * เตือนเจ้าของโปรเจกต์ให้อัปเดตสถานะประจำสัปดาห์ (แบบ Asana "status update reminder")
 * รันใน cron ?task=all (08:00 ทุกวัน) แต่ทำงานเฉพาะวันศุกร์ (เวลาไทย)
 * เตือนเฉพาะโปรเจกต์ที่ยังไม่ปิด และยังไม่มีอัปเดตใน 4 วันที่ผ่านมา (จันทร์–ศุกร์สัปดาห์นี้)
 * ?task=project-reminders&force=1 = รันได้ทุกวัน (ไว้ทดสอบ)
 */
export async function remindProjectStatusUpdates(opts: { force?: boolean } = {}) {
  const today = bangkokToday();
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (dow !== 5 && !opts.force) return { skipped: "not-friday", today };

  const startOfToday = Date.parse(`${today}T00:00:00+07:00`);
  const since = startOfToday - 4 * 864e5;
  const orgs = await prisma.organization.findMany({ where: { isActive: true }, select: { id: true } });
  const out = { orgs: orgs.length, reminded: 0, errors: [] as string[] };
  for (const { id: orgId } of orgs) {
    try {
      const { data: projects } = await readStore<Project[]>(orgId, "projects");
      const due = (projects ?? []).filter(
        (p) => !p.closedStatus && p.startDate <= today && !p.updates.some((u) => Date.parse(u.at) >= since)
      );
      if (!due.length) continue;
      const { data: existing, version } = await readStore<AppNotification[]>(orgId, "notifications");
      const now = new Date().toISOString();
      const fresh: AppNotification[] = due
        .map((p) => ({
          id: `notif-${randomUUID()}`,
          userId: p.ownerId,
          byUserId: "system",
          message: `ถึงเวลาอัปเดตสถานะโปรเจกต์ "${p.name}" ประจำสัปดาห์`,
          link: `/report-task/projects/${p.id}`,
          createdAt: now,
          read: false,
        }))
        // กันซ้ำ: วันนี้เตือนโปรเจกต์นี้ไปแล้ว (cron รันซ้ำ/กด force) ไม่ต้องเตือนอีก
        .filter((n) => !(existing ?? []).some((e) => e.userId === n.userId && e.message === n.message && Date.parse(e.createdAt) >= startOfToday));
      if (!fresh.length) continue;
      const saved = await writeStore(orgId, "notifications", [...fresh, ...(existing ?? [])], version);
      if (saved.ok) out.reminded += fresh.length;
    } catch (error) {
      console.error("[cron] project reminders", orgId, error);
      out.errors.push(`${orgId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}
