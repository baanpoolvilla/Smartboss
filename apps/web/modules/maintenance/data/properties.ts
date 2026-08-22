import "server-only";
import { prisma } from "@smartboss/database";

export interface PropertyInput {
  name: string;
  caretakerId?: string | null;
  address?: string | null;
  ownerName?: string | null;
  ownerContact?: string | null;
  notes?: string | null;
  /** null = ยังไม่จัดหมวด (ไม่ใช่ "หมวดอื่นๆ") */
  categoryId?: string | null;
}

/**
 * คืน categoryId ก็ต่อเมื่อเป็นหมวดของบริษัทนี้จริง ไม่งั้นคืน null
 *
 * ⚠ พึ่ง FK อย่างเดียวไม่พอ — FK บังคับแค่ว่า "หมวดนี้มีอยู่จริง" ไม่ได้บังคับว่า
 * เป็นหมวดของบริษัทเดียวกัน ยิง id หมวดของบริษัทอื่นเข้ามาจะผ่านฉลุย
 * แล้วชื่อหมวดของอีกบริษัทจะไปโผล่บนหน้าจอเรา
 */
async function ownedCategoryId(
  orgId: string,
  categoryId: string | null | undefined
): Promise<string | null> {
  if (!categoryId) return null;
  const owned = await prisma.propertyCategory.findFirst({
    where: { orgId, id: categoryId },
    select: { id: true },
  });
  return owned ? owned.id : null;
}

export function listProperties(orgId: string) {
  return prisma.property.findMany({
    where: { orgId },
    orderBy: { name: "asc" },
  });
}

export function getProperty(orgId: string, id: string) {
  return prisma.property.findFirst({ where: { orgId, id } });
}

export async function createProperty(orgId: string, data: PropertyInput) {
  const categoryId = await ownedCategoryId(orgId, data.categoryId);
  return prisma.property.create({
    data: {
      orgId,
      name: data.name,
      caretakerId: data.caretakerId ?? null,
      address: data.address ?? null,
      ownerName: data.ownerName ?? null,
      ownerContact: data.ownerContact ?? null,
      notes: data.notes ?? null,
      categoryId,
    },
  });
}

export async function updateProperty(
  orgId: string,
  id: string,
  data: PropertyInput
) {
  const categoryId = await ownedCategoryId(orgId, data.categoryId);
  await prisma.property.updateMany({
    where: { orgId, id },
    data: {
      name: data.name,
      caretakerId: data.caretakerId ?? null,
      address: data.address ?? null,
      ownerName: data.ownerName ?? null,
      ownerContact: data.ownerContact ?? null,
      notes: data.notes ?? null,
      categoryId,
    },
  });
}

/** ย้ายบ้านเข้าหมวด — null = เอาออกจากหมวด */
export async function setPropertyCategory(
  orgId: string,
  id: string,
  categoryId: string | null
) {
  // ส่ง id ที่ไม่ใช่ของบริษัทนี้มา = ถือว่าเอาออกจากหมวด ไม่ใช่ผูกข้ามบริษัท
  const safe = await ownedCategoryId(orgId, categoryId);
  await prisma.property.updateMany({
    where: { orgId, id },
    data: { categoryId: safe },
  });
}

export async function deleteProperty(orgId: string, id: string) {
  await prisma.property.deleteMany({ where: { orgId, id } });
}

/**
 * propertyId → ชื่อหมวดที่ถูกจัดไว้ · undefined = ยังไม่จัดหมวด
 *
 * ใช้ตัวนี้แทนการเดาจากชื่อบ้าน — ทุกหน้าที่จัดกลุ่มบ้าน (รายชื่อบ้าน · บอร์ดใบงาน ·
 * ปฏิทิน PM · แดชบอร์ด · ค่าใช้จ่าย) ต้องอ่านจากที่เดียวกัน ไม่งั้นย้ายบ้านข้ามหมวด
 * แล้วแต่ละหน้าจะบอกไม่ตรงกัน
 */
export async function propertyCategoryMap(
  orgId: string
): Promise<Record<string, string>> {
  const rows = await prisma.property.findMany({
    where: { orgId, categoryId: { not: null } },
    select: { id: true, category: { select: { displayName: true } } },
  });
  return Object.fromEntries(
    rows
      .filter((r) => r.category)
      .map((r) => [r.id, r.category!.displayName])
  );
}

/** นับใบงานค้าง (open/in_progress) ต่อบ้าน — ใช้ทำสถานะจุดสี */
export async function workOrderStatusCounts(
  orgId: string,
  propertyIds: string[]
): Promise<Record<string, { open: number; in_progress: number }>> {
  if (propertyIds.length === 0) return {};
  const rows = await prisma.workOrder.findMany({
    where: {
      orgId,
      propertyId: { in: propertyIds },
      status: { in: ["open", "in_progress"] },
    },
    select: { propertyId: true, status: true },
  });
  const res: Record<string, { open: number; in_progress: number }> = {};
  for (const r of rows) {
    const cur = (res[r.propertyId] ??= { open: 0, in_progress: 0 });
    if (r.status === "open") cur.open++;
    else if (r.status === "in_progress") cur.in_progress++;
  }
  return res;
}
