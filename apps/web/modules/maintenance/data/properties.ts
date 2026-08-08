import "server-only";
import { prisma } from "@smartboss/database";

export interface PropertyInput {
  name: string;
  caretakerId?: string | null;
  address?: string | null;
  ownerName?: string | null;
  ownerContact?: string | null;
  notes?: string | null;
  category?: string | null;
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

export function createProperty(orgId: string, data: PropertyInput) {
  return prisma.property.create({
    data: {
      orgId,
      name: data.name,
      caretakerId: data.caretakerId ?? null,
      address: data.address ?? null,
      ownerName: data.ownerName ?? null,
      ownerContact: data.ownerContact ?? null,
      notes: data.notes ?? null,
      category: data.category ?? null,
    },
  });
}

export async function updateProperty(
  orgId: string,
  id: string,
  data: PropertyInput
) {
  await prisma.property.updateMany({
    where: { orgId, id },
    data: {
      name: data.name,
      caretakerId: data.caretakerId ?? null,
      address: data.address ?? null,
      ownerName: data.ownerName ?? null,
      ownerContact: data.ownerContact ?? null,
      notes: data.notes ?? null,
      category: data.category ?? null,
    },
  });
}

export async function deleteProperty(orgId: string, id: string) {
  await prisma.property.deleteMany({ where: { orgId, id } });
}

/**
 * แยก "หมวดหมู่" จากคำนำหน้าชื่อบ้าน — port ตรงจาก properties_list_screen.dart
 * เช่น "BS-A1" -> "BS-A"
 */
export function categoryPrefix(name: string): string {
  const m = name.match(/^([A-Za-z]+-[A-Za-z]+)/);
  if (m && m[1]) return m[1];
  const f = name.match(/^(.+?)\d+$/);
  if (f && f[1]) return f[1];
  return "อื่นๆ";
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
