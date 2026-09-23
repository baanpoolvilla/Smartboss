import "server-only";
import { prisma } from "@smartboss/database";
import {
  workOrderVisibilityWhere,
  type WorkOrderAccess,
} from "@/modules/maintenance/data/work-order-access";

/**
 * ตัวเลขบนแดชบอร์ดต้องนับเฉพาะใบที่คนดูเปิดเข้าไปดูได้จริง — ไม่งั้นช่างจะเห็น
 * "งานด่วน 12 ใบ" แล้วกดเข้าไปเจอลิสต์ว่างเปล่า (หรือแย่กว่านั้นคือรู้ปริมาณงาน
 * ของบ้านที่ตัวเองไม่เกี่ยวข้อง) ตัวกรองมาจากที่เดียวกับหน้ารายการ
 */
function visible(access: WorkOrderAccess) {
  const w = workOrderVisibilityWhere(access);
  return w ? [w] : [];
}

export async function dashboardStats(orgId: string, access: WorkOrderAccess) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);

  const [urgent, todayCount, pendingPr, pmDueSoon, openWo, inProgress] =
    await Promise.all([
      prisma.workOrder.count({
        where: {
          orgId,
          priority: "urgent",
          status: { in: ["open", "in_progress"] },
          AND: visible(access),
        },
      }),
      prisma.workOrder.count({
        where: { orgId, createdAt: { gte: start, lt: end }, AND: visible(access) },
      }),
      prisma.purchaseOrder.count({ where: { orgId, status: "pending" } }),
      prisma.pmSchedule.count({
        where: { orgId, isActive: true, awaitingSchedule: false, nextDueDate: { lte: soon } },
      }),
      prisma.workOrder.count({ where: { orgId, status: "open", AND: visible(access) } }),
      prisma.workOrder.count({
        where: { orgId, status: "in_progress", AND: visible(access) },
      }),
    ]);

  return { urgent, todayCount, pendingPr, pmDueSoon, openWo, inProgress };
}

/** ใบงานที่ปิดแล้วแต่ยังไม่ได้บันทึกค่าใช้จ่าย (การ์ดสรุปบนแดชบอร์ด) */
export async function noExpenseWorkOrderCount(
  orgId: string,
  access: WorkOrderAccess
): Promise<number> {
  const rows = await prisma.expense.findMany({
    where: { orgId, workOrderId: { not: null } },
    select: { workOrderId: true },
  });
  const withExpense = rows
    .map((r) => r.workOrderId)
    .filter((x): x is string => !!x);
  return prisma.workOrder.count({
    where: {
      orgId,
      status: "completed",
      AND: visible(access),
      // ใบที่ตั้งไว้ว่าไม่ต้องกรอกค่าใช้จ่ายไม่ใช่งานค้าง — ถ้านับด้วย ตัวเลขแดง
      // บนแดชบอร์ดจะไม่มีวันลงถึงศูนย์ (กติกาเดียวกับ notifyMissingExpenses)
      requiresExpense: true,
      ...(withExpense.length > 0 ? { id: { notIn: withExpense } } : {}),
    },
  });
}

/** ใบงานล่าสุด 5 รายการ */
export function recentWorkOrders(
  orgId: string,
  access: WorkOrderAccess,
  limit = 5
) {
  return prisma.workOrder.findMany({
    where: { orgId, AND: visible(access) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
