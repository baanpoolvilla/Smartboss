import "server-only";
import { prisma } from "@smartboss/database";

/**
 * ชั้นเข้าถึงข้อมูลของโมดูล — ทุกฟังก์ชัน "บังคับรับ orgId" และกรองด้วย orgId เสมอ
 * = ข้อมูลถูกแยกตามบริษัท (tenant) โดยอัตโนมัติ ไม่มีทางหลุดข้ามบริษัท
 */

export function listExampleItems(orgId: string) {
  return prisma.exampleItem.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });
}

export function createExampleItem(
  orgId: string,
  input: { title: string; note?: string | null }
) {
  return prisma.exampleItem.create({
    data: { orgId, title: input.title, note: input.note ?? null },
  });
}

/** ลบแบบ scope ด้วย orgId — กันการลบข้ามบริษัทแม้จะเดา id ถูก */
export async function deleteExampleItem(orgId: string, id: string) {
  await prisma.exampleItem.deleteMany({ where: { id, orgId } });
}

/** สลับสถานะ open <-> done (scope ด้วย orgId) */
export async function toggleExampleItem(orgId: string, id: string) {
  const item = await prisma.exampleItem.findFirst({ where: { id, orgId } });
  if (!item) return;
  await prisma.exampleItem.update({
    where: { id: item.id },
    data: { status: item.status === "done" ? "open" : "done" },
  });
}
