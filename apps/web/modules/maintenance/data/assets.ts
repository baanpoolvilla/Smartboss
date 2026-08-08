import "server-only";
import { prisma } from "@smartboss/database";

export interface AssetInput {
  propertyId: string;
  name: string;
  category?: string | null;
  brand?: string | null;
  model?: string | null;
  installDate?: Date | null;
  warrantyExpiry?: Date | null;
  notes?: string | null;
  imageUrl?: string | null;
}

export function listAssets(orgId: string, propertyId?: string) {
  return prisma.asset.findMany({
    where: { orgId, ...(propertyId ? { propertyId } : {}) },
    orderBy: { name: "asc" },
  });
}

export function getAsset(orgId: string, id: string) {
  return prisma.asset.findFirst({ where: { orgId, id } });
}

export function createAsset(orgId: string, data: AssetInput) {
  return prisma.asset.create({
    data: {
      orgId,
      propertyId: data.propertyId,
      name: data.name,
      category: data.category ?? null,
      brand: data.brand ?? null,
      model: data.model ?? null,
      installDate: data.installDate ?? null,
      warrantyExpiry: data.warrantyExpiry ?? null,
      notes: data.notes ?? null,
      imageUrl: data.imageUrl ?? null,
    },
  });
}

export async function updateAsset(
  orgId: string,
  id: string,
  data: Partial<AssetInput>
) {
  await prisma.asset.updateMany({ where: { orgId, id }, data });
}

/** ลบอุปกรณ์ — ลบ PM schedule ที่ผูกก่อน (เหมือนของเดิม) */
export async function deleteAsset(orgId: string, id: string) {
  await prisma.pmSchedule.deleteMany({ where: { orgId, assetId: id } });
  await prisma.asset.deleteMany({ where: { orgId, id } });
}

/**
 * วันซ่อมบำรุงล่าสุดต่ออุปกรณ์ — จาก pm_schedules.last_completed_date
 * หรือ work_orders ที่ completed (port จาก getLastMaintenanceDates)
 */
export async function lastMaintenanceDates(
  orgId: string,
  assetIds: string[]
): Promise<Record<string, Date | null>> {
  const result: Record<string, Date | null> = Object.fromEntries(
    assetIds.map((id) => [id, null])
  );
  if (assetIds.length === 0) return result;

  const pmRows = await prisma.pmSchedule.findMany({
    where: { orgId, assetId: { in: assetIds }, lastCompletedDate: { not: null } },
    select: { assetId: true, lastCompletedDate: true },
  });
  for (const r of pmRows) {
    if (!r.assetId || !r.lastCompletedDate) continue;
    const cur = result[r.assetId];
    if (!cur || r.lastCompletedDate > cur) result[r.assetId] = r.lastCompletedDate;
  }

  const missing = assetIds.filter((id) => result[id] === null);
  if (missing.length > 0) {
    const woRows = await prisma.workOrder.findMany({
      where: {
        orgId,
        assetId: { in: missing },
        status: "completed",
        completedAt: { not: null },
      },
      select: { assetId: true, completedAt: true },
    });
    for (const r of woRows) {
      if (!r.assetId || !r.completedAt) continue;
      const cur = result[r.assetId];
      if (!cur || r.completedAt > cur) result[r.assetId] = r.completedAt;
    }
  }

  return result;
}
