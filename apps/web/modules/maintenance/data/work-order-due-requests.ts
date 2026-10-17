import "server-only";
import { prisma } from "@smartboss/database";

/**
 * คำขอเลื่อนกำหนดส่งของใบงาน (แบบเดียวกับ "ขอเลื่อนกำหนดส่ง" ของงานบนบอร์ดงาน)
 * ผู้รับผิดชอบขอ → CEO (สิทธิ์ดูข้อมูลทั้งบริษัท) หรือคนเปิดใบงาน อนุมัติ/ไม่อนุมัติ
 * อนุมัติ = แก้ work_orders.due_date (ทำใน server action) · ตารางแยก ไม่แตะคอลัมน์เดิมของใบงาน
 */
export type DueRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export function listDueRequests(orgId: string, workOrderId: string) {
  return prisma.workOrderDueRequest.findMany({
    where: { orgId, workOrderId },
    orderBy: { createdAt: "desc" },
  });
}

export function getDueRequest(orgId: string, id: string) {
  return prisma.workOrderDueRequest.findFirst({ where: { orgId, id } });
}

export function pendingDueRequest(orgId: string, workOrderId: string) {
  return prisma.workOrderDueRequest.findFirst({ where: { orgId, workOrderId, status: "pending" }, orderBy: { createdAt: "desc" } });
}

export async function createDueRequest(
  orgId: string,
  input: { workOrderId: string; requestedBy: string; previousDate: Date | null; newDate: Date; reason: string }
) {
  // ขอใหม่ = แทนคำขอที่ค้างอยู่ของใบงานนี้ (ใบงานมีผู้รับผิดชอบคนเดียว — ค้างได้ทีละคำขอ)
  await prisma.workOrderDueRequest.updateMany({
    where: { orgId, workOrderId: input.workOrderId, status: "pending" },
    data: { status: "cancelled", decidedBy: input.requestedBy, decidedAt: new Date(), decisionNote: "ขอใหม่แทน" },
  });
  return prisma.workOrderDueRequest.create({ data: { orgId, ...input } });
}

/** เปลี่ยนสถานะเฉพาะคำขอที่ยัง pending — คืน false ถ้ามีคนตัดสินไปก่อนแล้ว (กดพร้อมกัน) */
export async function decideDueRequest(
  orgId: string,
  id: string,
  data: { status: Exclude<DueRequestStatus, "pending">; decidedBy: string; decisionNote?: string | null }
): Promise<boolean> {
  const r = await prisma.workOrderDueRequest.updateMany({
    where: { orgId, id, status: "pending" },
    data: { status: data.status, decidedBy: data.decidedBy, decidedAt: new Date(), decisionNote: data.decisionNote ?? null },
  });
  return r.count > 0;
}
