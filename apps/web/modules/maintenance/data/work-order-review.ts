import "server-only";
import { prisma } from "@smartboss/database";

/**
 * บริษัทนี้ให้ตรวจใบแจ้งซ่อมก่อนบันทึกค่าใช้จ่ายไหม (ตั้งค่าโมดูลแจ้งซ่อม) — ไม่มีแถวตั้งค่า = เปิด
 * (ผู้ใช้ 10/11/2569 "ให้เปิดตรวจสอบเป็นค่าตั้งต้น เหมือน task") · กติกาอยู่ที่ lib/work-order-review.ts
 */
export async function loadWoReviewEnabled(orgId: string): Promise<boolean> {
  const row = await prisma.performanceSetting.findUnique({ where: { orgId }, select: { woReviewEnabled: true } });
  return row?.woReviewEnabled ?? true;
}
