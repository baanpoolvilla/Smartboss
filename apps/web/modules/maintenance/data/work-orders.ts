import "server-only";
import { prisma, Prisma } from "@smartboss/database";

import { nextWorkOrderCode } from "@/lib/document-code";
import {
  workOrderVisibilityWhere,
  type WorkOrderAccess,
} from "@/modules/maintenance/data/work-order-access";

export interface WorkOrderFilters {
  status?: string;
  statuses?: string[];
  propertyId?: string;
  assignedTo?: string;
  priority?: string;
  createdToday?: boolean;
  /**
   * จำกัดให้เห็นเฉพาะงานที่คนคนนี้เกี่ยวข้องจริง — ได้รับมอบหมาย / สร้างเอง /
   * ถูก CC / เป็นผู้ดูแลบ้านของงานนั้น (ดู data/work-order-access.ts)
   * ไม่ส่งมา = ไม่กรอง ⇒ ทุกที่ที่แสดงใบงานให้คนดู **ต้องส่งค่านี้เสมอ**
   */
  access?: WorkOrderAccess;
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

  const visibility = f.access ? workOrderVisibilityWhere(f.access) : null;
  if (visibility) and.push(visibility);

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

/** id → "WO-2569-0001 · หัวข้องาน" สำหรับแสดงใบงานต้นทางบนหน้า PR/PO */
export async function workOrderCodeMap(
  orgId: string,
  ids: (string | null | undefined)[]
): Promise<Record<string, { code: string; title: string }>> {
  const want = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (want.length === 0) return {};
  const rows = await prisma.workOrder.findMany({
    where: { orgId, id: { in: want } },
    select: { id: true, code: true, title: true },
  });
  return Object.fromEntries(
    rows.map((r) => [r.id, { code: r.code, title: r.title }])
  );
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

/** ส่งฟอร์มเดิมซ้ำภายในช่วงนี้ (คนเดิม หัวข้อเดิม บ้านเดิม) = กดเบิ้ล ไม่ใช่งานใหม่ */
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

/**
 * จองเลขที่ใบงานกับสร้างใบงานใน transaction เดียวกัน
 *
 * ถ้าแยกกัน แล้วการสร้างล้มทีหลัง เลขจะถูกกินไปเปล่า ๆ เกิดช่องว่าง
 * (WO-0001 แล้วข้ามไป WO-0003) ซึ่งคนอ่านจะนึกว่าใบงานหาย
 *
 * ── กันใบงานเบิ้ล ── คืน `duplicate: true` พร้อมใบเดิมแทนการสร้างใหม่ เมื่อ
 *   1. กดบันทึกซ้ำ: คนเดิมเพิ่งสร้างหัวข้อเดิมให้บ้านเดิมภายใน 2 นาที (อัปโหลดรูปช้า
 *      บนมือถือ คนนึกว่าไม่ติดเลยกดอีก — ทุกครั้งที่กดคือส่งฟอร์มใหม่)
 *   2. PM รอบนี้มีใบงานที่คนเปิดเองค้างอยู่แล้ว (สองคนกดเปิดจากปฏิทิน/หน้าอุปกรณ์
 *      พร้อมกัน หรือหน้าที่เปิดค้างไว้ยังโชว์ปุ่มอยู่) — ใบอัตโนมัติไม่นับ ตัวเรียก
 *      จะยกเลิกให้เอง (closeAutoWorkOrdersOfPm "replaced")
 * ล็อกก่อนเช็ค ไม่งั้นสองคำขอที่มาพร้อมกันเห็น "ยังไม่มี" ทั้งคู่ · ล็อก PM ใช้คีย์
 * เดียวกับ cron (generateWorkOrdersForDuePms) ⇒ คนเปิดเองกับ cron ก็ไม่ชนกันด้วย
 */
export function createWorkOrder(orgId: string, data: WorkOrderInput) {
  return prisma.$transaction(async (tx) => {
    const pmIds = [...new Set([...(data.pmScheduleId ? [data.pmScheduleId] : []), ...(data.pmScheduleIds ?? [])])].sort();
    for (const pmId of pmIds) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pm-auto-wo:${pmId}`}))`;
    }
    if (pmIds.length > 0) {
      const openForPm = await tx.workOrder.findFirst({
        where: {
          orgId,
          autoCreated: false,
          status: { in: ["open", "in_progress"] },
          OR: [{ pmScheduleId: { in: pmIds } }, { pmScheduleIds: { hasSome: pmIds } }],
        },
      });
      if (openForPm) return { workOrder: openForPm, duplicate: true as const };
    }

    if (data.createdBy) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wo-create:${orgId}:${data.createdBy}`}))`;
      const recent = await tx.workOrder.findFirst({
        where: {
          orgId,
          createdBy: data.createdBy,
          title: data.title,
          propertyId: data.propertyId,
          status: { not: "cancelled" },
          createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
        },
        orderBy: { createdAt: "desc" },
      });
      if (recent) return { workOrder: recent, duplicate: true as const };
    }

    const code = await nextWorkOrderCode(tx, orgId);
    const workOrder = await tx.workOrder.create({
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
    return { workOrder, duplicate: false as const };
  });
}

export async function updateWorkOrder(
  orgId: string,
  id: string,
  data: Partial<WorkOrderInput> & { completionNotes?: string | null }
) {
  await prisma.workOrder.updateMany({ where: { orgId, id }, data });
}

/**
 * เปลี่ยนสถานะ — คืน true เฉพาะเมื่อสถานะเปลี่ยนจริง
 *
 * ตัวเรียกใช้ค่านี้ตัดสินว่าจะเดิน/ข้ามรอบ PM หรือไม่ ห้ามใช้สถานะที่อ่านไว้ก่อนหน้า:
 * กด "ยืนยันเสร็จ" สองทีติดกัน (หรือสองคนกดพร้อมกัน) ทั้งสองคำขออ่านได้ "กำลังทำ"
 * แล้วต่างคนต่างเดิน PM ⇒ รอบกระโดดข้ามไปหนึ่งช่วงเต็ม ๆ · เงื่อนไขอยู่ใน WHERE
 * Postgres จึงให้แค่คำขอเดียวที่เปลี่ยนได้
 */
export async function updateWorkOrderStatus(
  orgId: string,
  id: string,
  status: string
): Promise<boolean> {
  const data: Prisma.WorkOrderUpdateManyMutationInput = { status };
  if (status === "completed") data.completedAt = new Date();
  const res = await prisma.workOrder.updateMany({ where: { orgId, id, status: { not: status } }, data });
  return res.count > 0;
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

/**
 * แก้ข้อความคอมเมนต์ — **เจ้าของคอมเมนต์เท่านั้น**
 *
 * ต่างจากการลบที่คนจัดการใบงานทำแทนได้ (ดูข้างล่าง) การแก้คือการเปลี่ยน
 * "คำพูดของคนอื่น" ให้กลายเป็นอย่างอื่นโดยไม่มีร่องรอย ซึ่งไม่ควรมีใครทำได้
 * นอกจากคนพูดเอง · เช็คสิทธิ์ในเงื่อนไข where ไม่ใช่มาเทียบทีหลัง (กติกา
 * เดียวกับ deletePoComment) — คืน true เมื่อแก้ได้จริง
 */
export async function updateWorkOrderComment(
  orgId: string,
  commentId: string,
  userId: string,
  content: string
): Promise<boolean> {
  const res = await prisma.workOrderComment.updateMany({
    where: { id: commentId, orgId, userId },
    data: { content },
  });
  return res.count > 0;
}

/**
 * ลบคอมเมนต์ใบงาน — คืน url รูปที่ต้องเก็บกวาดใน storage ต่อ
 *
 * เจ้าของลบของตัวเองได้ คนที่จัดการใบงานได้ลบของใครก็ได้ (คอมเมนต์ที่พิมพ์ผิด
 * หรือแนบรูปผิดใบ ปล่อยไว้แล้วคนอ่านสับสนกว่า) — กติกาเดียวกับคอมเมนต์ PO
 */
export async function deleteWorkOrderComment(
  orgId: string,
  commentId: string,
  userId: string,
  canManageAll: boolean
): Promise<string[]> {
  const row = await prisma.workOrderComment.findFirst({
    where: { id: commentId, orgId, ...(canManageAll ? {} : { userId }) },
    select: { id: true, imageUrl: true },
  });
  if (!row) return [];
  await prisma.workOrderComment.delete({ where: { id: row.id } });
  return row.imageUrl ? [row.imageUrl] : [];
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
