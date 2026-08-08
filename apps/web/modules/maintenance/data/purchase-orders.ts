import "server-only";
import { prisma } from "@smartboss/database";
import { poItemsToJson, type PoItem } from "@/modules/maintenance/lib/po";

export function listPurchaseOrders(orgId: string, filter?: { status?: string }) {
  return prisma.purchaseOrder.findMany({
    where: { orgId, ...(filter?.status ? { status: filter.status } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

export function getPurchaseOrder(orgId: string, id: string) {
  return prisma.purchaseOrder.findFirst({ where: { orgId, id } });
}

export interface PoInput {
  title: string;
  description?: string | null;
  propertyId?: string | null;
  items: PoItem[];
  totalPrice: number;
  notes?: string | null;
  isSelfPurchase?: boolean;
  isEmergencyPurchase?: boolean;
  emergencyReason?: string | null;
  createdBy?: string | null;
  prImageUrls?: string[];
  /** "เปิด PO เลย" — role สูงข้ามขั้นรออนุมัติ (status = approved) */
  status?: string;
  poAssignedTo?: string | null;
  poCreatedBy?: string | null;
  poCreatedAt?: Date | null;
}

export function createPurchaseOrder(orgId: string, data: PoInput) {
  return prisma.purchaseOrder.create({
    data: {
      orgId,
      title: data.title,
      description: data.description ?? null,
      propertyId: data.propertyId ?? null,
      items: poItemsToJson(data.items),
      totalPrice: data.totalPrice,
      notes: data.notes ?? null,
      isSelfPurchase: data.isSelfPurchase ?? false,
      isEmergencyPurchase: data.isEmergencyPurchase ?? false,
      emergencyReason: data.emergencyReason ?? null,
      createdBy: data.createdBy ?? null,
      prImageUrls: data.prImageUrls ?? [],
      status: data.status ?? "pending",
      poAssignedTo: data.poAssignedTo ?? null,
      poCreatedBy: data.poCreatedBy ?? null,
      poCreatedAt: data.poCreatedAt ?? null,
    },
  });
}

export async function updatePurchaseOrder(
  orgId: string,
  id: string,
  data: Record<string, unknown>
) {
  await prisma.purchaseOrder.updateMany({ where: { orgId, id }, data });
}

export async function deletePurchaseOrder(orgId: string, id: string) {
  await prisma.purchaseOrder.deleteMany({ where: { orgId, id } });
}

export async function pendingPrCount(orgId: string): Promise<number> {
  return prisma.purchaseOrder.count({ where: { orgId, status: "pending" } });
}

// ─── Comments ─────────────────────────────────────────
export function listPoComments(orgId: string, poId: string) {
  return prisma.purchaseOrderComment.findMany({
    where: { orgId, purchaseOrderId: poId },
    orderBy: { createdAt: "asc" },
  });
}

export function addPoComment(
  orgId: string,
  poId: string,
  userId: string | null,
  content: string,
  imageUrls: string[] = []
) {
  return prisma.purchaseOrderComment.create({
    data: { orgId, purchaseOrderId: poId, userId, content, imageUrls },
  });
}
