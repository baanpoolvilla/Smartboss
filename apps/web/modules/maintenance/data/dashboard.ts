import "server-only";
import { prisma } from "@smartboss/database";

export async function dashboardStats(orgId: string) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);

  const [urgent, todayCount, pendingPr, pmDueSoon, openWo, inProgress] =
    await Promise.all([
      prisma.workOrder.count({
        where: { orgId, priority: "urgent", status: { in: ["open", "in_progress"] } },
      }),
      prisma.workOrder.count({ where: { orgId, createdAt: { gte: start, lt: end } } }),
      prisma.purchaseOrder.count({ where: { orgId, status: "pending" } }),
      prisma.pmSchedule.count({
        where: { orgId, isActive: true, awaitingSchedule: false, nextDueDate: { lte: soon } },
      }),
      prisma.workOrder.count({ where: { orgId, status: "open" } }),
      prisma.workOrder.count({ where: { orgId, status: "in_progress" } }),
    ]);

  return { urgent, todayCount, pendingPr, pmDueSoon, openWo, inProgress };
}

/** ใบงานที่ปิดแล้วแต่ยังไม่ได้บันทึกค่าใช้จ่าย (การ์ดสรุปบนแดชบอร์ด) */
export async function noExpenseWorkOrderCount(orgId: string): Promise<number> {
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
      ...(withExpense.length > 0 ? { id: { notIn: withExpense } } : {}),
    },
  });
}

/** ใบงานล่าสุด 5 รายการ */
export function recentWorkOrders(orgId: string, limit = 5) {
  return prisma.workOrder.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
