import "server-only";
import { prisma, Prisma } from "@smartboss/database";

import { nextWorkOrderCode } from "@/lib/document-code";

export interface WorkOrderFilters {
  status?: string;
  statuses?: string[];
  propertyId?: string;
  assignedTo?: string;
  priority?: string;
  createdToday?: boolean;
  /** จำกัดให้เห็นเฉพาะงานของ user นี้ (ช่าง: งานที่ได้รับหรือสร้างเอง) */
  restrictUserId?: string;
}

function buildWhere(orgId: string, f: WorkOrderFilters): Prisma.WorkOrderWhereInput {
  const and: Prisma.WorkOrderWhereInput[] = [{ orgId }];

  if (f.status) and.push({ status: f.status });
  if (f.statuses) and.push({ status: { in: f.statuses } });
  if (f.priority) and.push({ priority: f.priority });
  if (f.assignedTo) and.push({ assignedTo: f.assignedTo });

  if (f.propertyId) {
    and.push({
      OR: [
        { propertyId: f.propertyId },
        { additionalPropertyIds: { has: f.propertyId } },
      ],
    });
  }

  if (f.createdToday) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    and.push({ createdAt: { gte: start, lt: end } });
  }

  if (f.restrictUserId) {
    and.push({
      OR: [
        { assignedTo: f.restrictUserId },
        { createdBy: f.restrictUserId },
      ],
    });
  }

  return { AND: and };
}

export function listWorkOrders(orgId: string, f: WorkOrderFilters = {}) {
  return prisma.workOrder.findMany({
    where: buildWhere(orgId, f),
    orderBy: { createdAt: "desc" },
  });
}

export function getWorkOrder(orgId: string, id: string) {
  return prisma.workOrder.findFirst({ where: { orgId, id } });
}

/** set ของ workOrderId ที่มีค่าใช้จ่ายแล้ว (ใช้แยกคอลัมน์ "ยังไม่บันทึกค่าใช้จ่าย") */
export async function workOrderIdsWithExpenses(
  orgId: string
): Promise<Set<string>> {
  const rows = await prisma.expense.findMany({
    where: { orgId, workOrderId: { not: null } },
    select: { workOrderId: true },
  });
  return new Set(rows.map((r) => r.workOrderId).filter((x): x is string => !!x));
}

export interface WorkOrderInput {
  propertyId: string;
  assetId?: string | null;
  assignedTo?: string | null;
  createdBy?: string | null;
  title: string;
  description?: string | null;
  priority?: string;
  dueDate?: Date | null;
  ccUserIds?: string[];
  additionalPropertyIds?: string[];
  pmScheduleId?: string | null;
  pmScheduleIds?: string[];
  autoCreated?: boolean;
  /** false = งานนี้ไม่มีค่าใช้จ่าย (ไม่ถามตอนปิดงาน ไม่ถูกทวงในรายงาน) */
  requiresExpense?: boolean;
  photoUrls?: string[];
  afterPhotoUrls?: string[];
}

/**
 * จองเลขที่ใบงานกับสร้างใบงานใน transaction เดียวกัน
 *
 * ถ้าแยกกัน แล้วการสร้างล้มทีหลัง เลขจะถูกกินไปเปล่า ๆ เกิดช่องว่าง
 * (WO-0001 แล้วข้ามไป WO-0003) ซึ่งคนอ่านจะนึกว่าใบงานหาย
 */
export function createWorkOrder(orgId: string, data: WorkOrderInput) {
  return prisma.$transaction(async (tx) => {
    const code = await nextWorkOrderCode(tx, orgId);
    return tx.workOrder.create({
      data: {
        orgId,
        code,
        propertyId: data.propertyId,
        assetId: data.assetId ?? null,
        assignedTo: data.assignedTo ?? null,
        createdBy: data.createdBy ?? null,
        title: data.title,
        description: data.description ?? null,
        priority: data.priority ?? "medium",
        dueDate: data.dueDate ?? null,
        ccUserIds: data.ccUserIds ?? [],
        additionalPropertyIds: data.additionalPropertyIds ?? [],
        pmScheduleId: data.pmScheduleId ?? null,
        pmScheduleIds: data.pmScheduleIds ?? [],
        autoCreated: data.autoCreated ?? false,
        requiresExpense: data.requiresExpense ?? true,
        photoUrls: data.photoUrls ?? [],
      },
    });
  });
}

export async function updateWorkOrder(
  orgId: string,
  id: string,
  data: Partial<WorkOrderInput> & { completionNotes?: string | null }
) {
  await prisma.workOrder.updateMany({ where: { orgId, id }, data });
}

export async function updateWorkOrderStatus(
  orgId: string,
  id: string,
  status: string
) {
  const data: Prisma.WorkOrderUpdateManyMutationInput = { status };
  if (status === "completed") data.completedAt = new Date();
  await prisma.workOrder.updateMany({ where: { orgId, id }, data });
}

export async function deleteWorkOrder(orgId: string, id: string) {
  await prisma.workOrder.deleteMany({ where: { orgId, id } });
}

// ─── Comments ─────────────────────────────────────────
export function listWorkOrderComments(orgId: string, workOrderId: string) {
  return prisma.workOrderComment.findMany({
    where: { orgId, workOrderId },
    orderBy: { createdAt: "asc" },
  });
}

export function addWorkOrderComment(
  orgId: string,
  workOrderId: string,
  userId: string | null,
  content: string,
  imageUrl?: string | null
) {
  return prisma.workOrderComment.create({
    data: { orgId, workOrderId, userId, content, imageUrl: imageUrl ?? null },
  });
}
