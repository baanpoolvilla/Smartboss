import "server-only";
import { prisma } from "@smartboss/database";
import type { OrgSession } from "@smartboss/auth";
import { canSeeWorkOrder, workOrderAccess } from "@/modules/maintenance/data/work-order-access";

/**
 * แผน PM ที่มีใบรอบเปิดอยู่ซึ่งคนนี้มองไม่เห็น (เช่น ใบส่วนตัวของคนอื่น / บ้านที่ไม่ได้ดูแล)
 *
 * updatePmAction ไม่ยอมเปลี่ยนวันของแผนแบบนี้ (เลื่อนใบที่มองไม่เห็นไม่ได้ ถ้าเปลี่ยนแค่วันในแผนจะเกิดใบซ้ำ)
 * เดิมกดบันทึกแล้ววันเฉย ๆ ไม่มีอะไรบอก — หน้าแก้แผนใช้ตัวนี้ล็อกช่องวันพร้อมบอกเหตุผลก่อนกด (ผู้ใช้ 5/11/2569)
 * กติกาเดียวกับใน updatePmAction: ใบรอบ (pmRoundDate) ที่ยังเปิด/กำลังทำ ของแผนนั้น
 */
export async function pmIdsWithHiddenOpenRounds(session: OrgSession, pmIds: string[]): Promise<Set<string>> {
  if (pmIds.length === 0) return new Set();
  const access = await workOrderAccess(session);
  if (access.seeAll) return new Set();
  const rows = await prisma.workOrder.findMany({
    where: { orgId: session.orgId, pmScheduleId: { in: pmIds }, status: { in: ["open", "in_progress"] }, pmRoundDate: { not: null } },
    select: {
      id: true,
      pmScheduleId: true,
      assignedTo: true,
      groupMemberIds: true,
      createdBy: true,
      ccUserIds: true,
      propertyId: true,
      additionalPropertyIds: true,
      isPrivate: true,
    },
  });
  return new Set(rows.filter((w) => !canSeeWorkOrder(access, w)).map((w) => w.pmScheduleId!));
}
