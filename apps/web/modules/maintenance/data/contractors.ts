import "server-only";
import { prisma } from "@smartboss/database";

import { facetsOf, UNSET } from "@/modules/maintenance/lib/contacts";

export interface ContractorInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  specialty?: string | null;
  companyName?: string | null;
  notes?: string | null;
  zone?: string | null;
  rating?: number | null;
  price?: number | null;
  category?: string | null;
  isActive?: boolean;
}

export function listContractors(orgId: string, activeOnly = false) {
  return prisma.contractor.findMany({
    where: { orgId, ...(activeOnly ? { isActive: true } : {}) },
    orderBy: { name: "asc" },
  });
}

export function getContractor(orgId: string, id: string) {
  return prisma.contractor.findFirst({ where: { orgId, id } });
}

/**
 * หมวดหมู่และโซนที่บริษัทนี้ใช้อยู่จริง — ตัวเลือกในฟอร์มมาจากที่นี่
 *
 * ไม่ใช่รายการตายตัวในโค้ด เพราะแต่ละบริษัทแบ่งหมวดและแบ่งพื้นที่ไม่เหมือนกัน
 * (ดู lib/contacts.ts) เรียงตามที่ใช้บ่อยไปน้อย
 */
export async function contractorOptions(
  orgId: string
): Promise<{ categories: string[]; zones: string[] }> {
  const rows = await prisma.contractor.findMany({
    where: { orgId },
    select: { category: true, zone: true },
  });
  const pick = (get: (r: (typeof rows)[number]) => string | null) =>
    facetsOf(rows, get)
      .filter((f) => f.value !== UNSET)
      .map((f) => f.value);
  return { categories: pick((r) => r.category), zones: pick((r) => r.zone) };
}

export function createContractor(orgId: string, data: ContractorInput) {
  return prisma.contractor.create({
    data: {
      orgId,
      name: data.name,
      phone: data.phone ?? null,
      email: data.email ?? null,
      specialty: data.specialty ?? null,
      companyName: data.companyName ?? null,
      notes: data.notes ?? null,
      zone: data.zone ?? null,
      rating: data.rating ?? null,
      price: data.price ?? null,
      category: data.category ?? null,
      isActive: data.isActive ?? true,
    },
  });
}

export async function updateContractor(
  orgId: string,
  id: string,
  data: Partial<ContractorInput>
) {
  await prisma.contractor.updateMany({ where: { orgId, id }, data });
}

export async function deleteContractor(orgId: string, id: string) {
  await prisma.contractor.deleteMany({ where: { orgId, id } });
}

export function listContractorHistory(orgId: string, contractorId: string) {
  return prisma.contractorHistory.findMany({
    where: { orgId, contractorId },
    orderBy: { workDate: "desc" },
  });
}

export function createContractorHistory(
  orgId: string,
  data: {
    contractorId: string;
    workOrderId?: string | null;
    propertyId?: string | null;
    description?: string | null;
    amount?: number | null;
    workDate?: Date | null;
    rating?: number | null;
    notes?: string | null;
  }
) {
  return prisma.contractorHistory.create({
    data: {
      orgId,
      contractorId: data.contractorId,
      workOrderId: data.workOrderId ?? null,
      propertyId: data.propertyId ?? null,
      description: data.description ?? null,
      amount: data.amount ?? null,
      workDate: data.workDate ?? null,
      rating: data.rating ?? null,
      notes: data.notes ?? null,
    },
  });
}
