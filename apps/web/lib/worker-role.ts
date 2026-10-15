import "server-only";
import { prisma } from "@smartboss/database";
import { crossOrg } from "@smartboss/database/cross-org";

import { WORKER_ROLE_CODE } from "@/modules/daily_worker/permissions";

/**
 * ผู้ใช้ที่ถือบทบาทคนงาน (WORKER) — ไม่คิดคะแนนทุกเรื่อง (โมดูลคนงานรายวัน)
 * ใช้กรองที่จุดบันทึกคะแนน (recordPerformanceEvents + ตัวหักคะแนนรีพอต) และหน้าคะแนน
 * ไม่ย้อนหลัง: คะแนนที่บันทึกไปแล้วก่อนเป็นคนงานยังอยู่ (แค่ไม่ขึ้นในหน้าคะแนนรวม)
 */
export async function workerUserIds(userIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Set();
  // งานข้ามบริษัท (cron) ส่งผู้ใช้หลายบริษัทมารวมกัน — กรองด้วย userId ที่ได้มาเท่านั้น
  const rows = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.userRole.findMany({
      where: { userId: { in: ids }, role: { code: WORKER_ROLE_CODE } },
      select: { userId: true },
    })
  );
  return new Set(rows.map((r) => r.userId));
}

/** ผู้ใช้คนนี้เป็นคนงานไหม — ใช้กันคนงานออกจากห้องรวมทั้งบริษัทในแชท */
export async function isWorkerUser(userId: string): Promise<boolean> {
  const n = await prisma.userRole.count({ where: { userId, role: { code: WORKER_ROLE_CODE } } });
  return n > 0;
}

/** เงื่อนไข Prisma ของ user ที่ "ไม่ใช่คนงาน" — ต่อท้าย where ได้เลย */
export const NOT_WORKER = { NOT: { roles: { some: { role: { code: WORKER_ROLE_CODE } } } } } as const;
