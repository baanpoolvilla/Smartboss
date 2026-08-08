import "server-only";
import { prisma } from "@smartboss/database";

/** คืนของ / ของมีปัญหา — port จาก equipment_returns (migration 059) */

export const RETURN_PROBLEM: Record<string, string> = {
  defective: "ชำรุด / ใช้งานไม่ได้",
  wrong: "ผิดรุ่น / ผิดสเปก",
  damaged: "แตกหักระหว่างส่ง",
  missing: "ของขาด / ไม่ครบ",
  other: "อื่น ๆ",
};

export const RETURN_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "รอดำเนินการ", color: "#EA580C" },
  processing: { label: "กำลังดำเนินการ", color: "#4F46E5" },
  resolved: { label: "จบเรื่องแล้ว", color: "#16A34A" },
  cancelled: { label: "ยกเลิก", color: "#6B7280" },
};

export function returnStatusMeta(s: string) {
  return RETURN_STATUS[s] ?? { label: s, color: "#6B7280" };
}

export function listEquipmentReturns(orgId: string) {
  return prisma.equipmentReturn.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    include: { purchaseOrder: { select: { title: true } } },
  });
}

export function getEquipmentReturn(orgId: string, id: string) {
  return prisma.equipmentReturn.findFirst({
    where: { orgId, id },
    include: { purchaseOrder: { select: { title: true } } },
  });
}

export interface ReturnInput {
  purchaseOrderId: string;
  propertyId?: string | null;
  itemName?: string | null;
  qty: number;
  problemType: string;
  reason: string;
  imageUrls?: string[];
  createdBy?: string | null;
}

export function createEquipmentReturn(orgId: string, data: ReturnInput) {
  return prisma.equipmentReturn.create({
    data: {
      orgId,
      purchaseOrderId: data.purchaseOrderId,
      propertyId: data.propertyId ?? null,
      itemName: data.itemName ?? null,
      qty: data.qty,
      problemType: data.problemType,
      reason: data.reason,
      status: "pending",
      imageUrls: data.imageUrls ?? [],
      createdBy: data.createdBy ?? null,
    },
  });
}

export async function updateEquipmentReturnStatus(
  orgId: string,
  id: string,
  status: string,
  opts: { resolvedBy?: string | null; resolutionNote?: string | null } = {}
) {
  await prisma.equipmentReturn.updateMany({
    where: { orgId, id },
    data: {
      status,
      ...(status === "resolved"
        ? { resolvedBy: opts.resolvedBy ?? null, resolvedAt: new Date() }
        : {}),
      ...(opts.resolutionNote ? { resolutionNote: opts.resolutionNote } : {}),
    },
  });
}

export async function deleteEquipmentReturn(orgId: string, id: string) {
  await prisma.equipmentReturn.deleteMany({ where: { orgId, id } });
}
