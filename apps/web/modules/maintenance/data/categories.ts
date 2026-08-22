import "server-only";
import { prisma } from "@smartboss/database";

/**
 * หมวดหมู่บ้าน — เป็นของที่บริษัทสร้างเอง ไม่ใช่ค่าที่เดาจากชื่อบ้านอีกต่อไป
 *
 * เดิมหมวดถูกคำนวณจากคำนำหน้าชื่อ (BS-M4 → BS-M) ทุกครั้งที่ render ⇒ ย้ายบ้าน
 * ข้ามหมวดไม่ได้นอกจากเปลี่ยนชื่อบ้าน และสร้างหมวดเปล่าไว้รอไม่ได้
 * ตอนนี้เป็นตารางจริง มี property.categoryId ชี้มา (ดู migration 20260822100000)
 */

export interface CategoryRow {
  id: string;
  displayName: string;
  sortOrder: number;
}

/** เรียงตามลำดับที่ตั้งไว้ก่อน แล้วค่อยตามชื่อ — ให้ทุกหน้าเห็นลำดับเดียวกัน */
export function listCategories(orgId: string) {
  return prisma.propertyCategory.findMany({
    where: { orgId },
    orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }],
  });
}

/** id → ชื่อหมวด สำหรับหน้าที่ต้องแปลง categoryId ของบ้านเป็นชื่อ */
export async function categoryNameById(
  orgId: string
): Promise<Record<string, string>> {
  const rows = await listCategories(orgId);
  return Object.fromEntries(rows.map((r) => [r.id, r.displayName]));
}

export async function createCategory(orgId: string, displayName: string) {
  const last = await prisma.propertyCategory.findFirst({
    where: { orgId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  // หมวดใหม่ไปต่อท้ายเสมอ ไม่แทรกกลาง — คนที่จัดลำดับไว้แล้วจะได้ไม่งง
  await prisma.propertyCategory.create({
    data: { orgId, displayName, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
}

export async function renameCategory(
  orgId: string,
  id: string,
  displayName: string
) {
  // กรอง orgId ใน where ไม่ใช่มาเทียบทีหลัง — กันยิง id ข้ามบริษัทเข้ามาแก้
  await prisma.propertyCategory.updateMany({
    where: { orgId, id },
    data: { displayName },
  });
}

/**
 * ลบหมวด — บ้านที่อยู่ในหมวดนั้นไม่ถูกลบตาม
 *
 * FK เป็น ON DELETE SET NULL ⇒ บ้านกลับไปกอง "ยังไม่จัดหมวด" ให้คนมาจัดใหม่
 * (ดูจำนวนบ้านก่อนลบได้จาก listCategoriesWithCount)
 */
export async function deleteCategory(orgId: string, id: string) {
  await prisma.propertyCategory.deleteMany({ where: { orgId, id } });
}

/** สลับลำดับกับหมวดที่อยู่ติดกัน — คืน false เมื่อขยับต่อไม่ได้แล้ว */
export async function moveCategory(
  orgId: string,
  id: string,
  dir: "up" | "down"
): Promise<boolean> {
  const rows = await listCategories(orgId);
  const i = rows.findIndex((r) => r.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i === -1 || j < 0 || j >= rows.length) return false;

  /*
   * เขียนลำดับใหม่ทั้งชุดจากตำแหน่งในอาร์เรย์ ไม่ใช่สลับแค่ค่า sortOrder ของสองแถว
   *
   * ข้อมูลที่ backfill มามี sortOrder = 0 เท่ากันหมด การสลับค่าที่เท่ากันสองตัว
   * ไม่ทำให้อะไรขยับ — จะกดปุ่มกี่ทีลำดับก็เหมือนเดิมโดยไม่มี error ให้เห็น
   */
  const order = rows.map((r) => r.id);
  [order[i], order[j]] = [order[j]!, order[i]!];

  await prisma.$transaction(
    order.map((cid, idx) =>
      prisma.propertyCategory.updateMany({
        where: { orgId, id: cid },
        data: { sortOrder: idx + 1 },
      })
    )
  );
  return true;
}

/** หมวดพร้อมจำนวนบ้านในหมวด — ใช้บนหน้าจัดการหมวด */
export async function listCategoriesWithCount(orgId: string) {
  const [rows, counts] = await Promise.all([
    listCategories(orgId),
    prisma.property.groupBy({
      by: ["categoryId"],
      where: { orgId, categoryId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const n = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  return rows.map((r) => ({ ...r, propertyCount: n.get(r.id) ?? 0 }));
}
