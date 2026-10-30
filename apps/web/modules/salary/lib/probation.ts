import "server-only";
import { prisma } from "@smartboss/database";

/**
 * พนักงานใหม่ (ยังไม่ผ่านโปร) ตั้งต้นไม่ได้ค่าคอม + เบี้ยขยัน จนกว่า HR ติ๊กให้ (ผู้ใช้ 30/10/2569 "ต้องตั้งไม่ได้ก่อนพนักงานใหม่หลังจากนี้")
 * พนักงานใหม่ = เริ่มงานตั้งแต่วันที่บริษัทเริ่มใช้กติกานี้ (core.commission_settings.probation_from) — คนเก่าเหมือนเดิม
 */
export async function loadProbationFrom(orgId: string): Promise<string | null> {
  const s = await prisma.commissionSetting.findUnique({ where: { orgId }, select: { probationFrom: true } });
  return s?.probationFrom ? s.probationFrom.toISOString().slice(0, 10) : null;
}

export function isNewHire(hiredOn: string | null | undefined, probationFrom: string | null): boolean {
  return !!probationFrom && !!hiredOn && hiredOn >= probationFrom;
}
