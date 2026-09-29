import "server-only";
import { prisma } from "@smartboss/database";

import { nextPurchaseOrderCode } from "@/lib/document-code";
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

/** PR/PO ทุกใบที่เปิดจากใบงานนี้ — เรียงใบเก่าขึ้นก่อนให้อ่านเป็นลำดับเหตุการณ์ */
export function listPurchaseOrdersForWorkOrder(orgId: string, workOrderId: string) {
  return prisma.purchaseOrder.findMany({
    where: { orgId, workOrderId },
    orderBy: { createdAt: "asc" },
  });
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
  /** ใบงานต้นทาง — ผู้เรียกต้องตรวจก่อนแล้วว่า id นี้เป็นใบงานของบริษัทเดียวกันจริง */
  workOrderId?: string | null;
  emergencyReason?: string | null;
  createdBy?: string | null;
  prImageUrls?: string[];
  /** "เปิด PO เลย" — role สูงข้ามขั้นรออนุมัติ (status = approved) */
  status?: string;
  poAssignedTo?: string | null;
  poCreatedBy?: string | null;
  poCreatedAt?: Date | null;
}

/**
 * จองเลขที่กับสร้างใบสั่งซื้อใน transaction เดียว — ดู lib/document-code.ts
 *
 * กันกดเปิด PR ซ้ำ: คนเดิม หัวข้อเดิม ใบงานเดิม ภายใน 2 นาที = คำขอซ้ำ คืนใบเดิม
 * (`duplicate: true`) แทนการเปิดใบใหม่ — กติกาเดียวกับ createWorkOrder
 */
export function createPurchaseOrder(orgId: string, data: PoInput) {
  return prisma.$transaction(async (tx) => {
    if (data.createdBy) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`po-create:${orgId}:${data.createdBy}`}))`;
      const recent = await tx.purchaseOrder.findFirst({
        where: {
          orgId,
          createdBy: data.createdBy,
          title: data.title,
          workOrderId: data.workOrderId ?? null,
          status: { not: "cancelled" },
          createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
        },
      });
      if (recent) return { purchaseOrder: recent, duplicate: true as const };
    }
    const code = await nextPurchaseOrderCode(tx, orgId);
    const purchaseOrder = await tx.purchaseOrder.create({
      data: {
        orgId,
        code,
        title: data.title,
        description: data.description ?? null,
        propertyId: data.propertyId ?? null,
        workOrderId: data.workOrderId ?? null,
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
    return { purchaseOrder, duplicate: false as const };
  });
}

export async function updatePurchaseOrder(
  orgId: string,
  id: string,
  data: Record<string, unknown>
) {
  await prisma.purchaseOrder.updateMany({ where: { orgId, id }, data });
}

/**
 * เปลี่ยนสถานะ PR/PO เฉพาะเมื่อยังอยู่ในสถานะ `from` — คืน true เมื่อคำขอนี้เป็นคนเปลี่ยนจริง
 *
 * ขั้นที่ลงค่าใช้จ่าย (ยืนยันสั่งซื้อ / อนุมัติฉุกเฉิน / ซื้อเอง) ต้องใช้ตัวนี้แล้วลงค่าใช้จ่าย
 * เฉพาะเมื่อได้ true: เดิมกดซ้ำหรือสองคนกดพร้อมกัน = ลงค่าใช้จ่ายสองก้อน ยอดเงินเบิ้ล
 * และกดขั้นเดิมกับใบที่ผ่านขั้นนั้นไปแล้วได้ (ไม่มีการเช็คสถานะเลย)
 */
export async function transitionPurchaseOrder(
  orgId: string,
  id: string,
  from: string[],
  data: Record<string, unknown>
): Promise<boolean> {
  const res = await prisma.purchaseOrder.updateMany({ where: { orgId, id, status: { in: from } }, data });
  return res.count > 0;
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

/**
 * ลบคอมเมนต์ PO — คืนรายการรูปที่ต้องเก็บกวาดใน storage ต่อ
 *
 * เจ้าของคอมเมนต์ลบของตัวเองได้ ส่วนคนที่จัดการ PO ได้ลบของใครก็ได้
 * (คอมเมนต์ที่พิมพ์ผิดหรือแนบรูปผิดใบ ปล่อยไว้แล้วคนอ่านสับสนกว่า)
 *
 * ⚠ เช็คสิทธิ์ด้วยเงื่อนไขใน where ไม่ใช่ค่อยมาเทียบทีหลัง — ถ้าเช็คทีหลัง
 * ต้องอ่านแถวออกมาก่อน ซึ่งเปิดช่องให้ยิง id ข้ามบริษัทเข้ามาดูข้อมูลได้
 */
export async function deletePoComment(
  orgId: string,
  commentId: string,
  userId: string,
  canManageAll: boolean
): Promise<string[]> {
  const row = await prisma.purchaseOrderComment.findFirst({
    where: {
      id: commentId,
      orgId,
      ...(canManageAll ? {} : { userId }),
    },
    select: { id: true, imageUrls: true },
  });
  if (!row) return [];
  await prisma.purchaseOrderComment.delete({ where: { id: row.id } });
  return row.imageUrls;
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
