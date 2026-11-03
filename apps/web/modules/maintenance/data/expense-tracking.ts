import "server-only";
import { cache } from "react";
import { prisma } from "@smartboss/database";
import type { ExpenseTracking } from "@/modules/maintenance/lib/expense-deadline";

/** การตั้งค่าของบริษัท — ดู lib/expense-deadline.ts */
export const loadExpenseTracking = cache(async (orgId: string): Promise<ExpenseTracking> => {
  const row = await prisma.performanceSetting.findUnique({
    where: { orgId },
    select: { expenseTrackFrom: true, expenseTrackDays: true, expenseRecorderIds: true },
  });
  return { from: row?.expenseTrackFrom ?? null, days: row?.expenseTrackDays ?? 14, recorderIds: row?.expenseRecorderIds ?? [] };
});

/** ใบค้างบันทึกของบริษัท เก่าสุดก่อน — ค่าใช้จ่ายไม่มี relation กับใบงาน จึงกรองด้วยรายการ id */
export const pendingExpenseWorkOrders = cache(async (orgId: string) => {
  const rows = await prisma.expense.findMany({ where: { orgId, workOrderId: { not: null } }, select: { workOrderId: true }, distinct: ["workOrderId"] });
  const withExpense = rows.map((r) => r.workOrderId).filter((x): x is string => !!x);
  return prisma.workOrder.findMany({
    where: {
      orgId,
      status: "completed",
      requiresExpense: true,
      isPrivate: false,
      ...(withExpense.length > 0 ? { id: { notIn: withExpense } } : {}),
    },
    select: { id: true, code: true, title: true, completedAt: true, expenseDueDate: true },
    orderBy: { completedAt: "asc" },
  });
});

/** ผู้มีบทบาท CEO ที่ยังใช้งานอยู่ — คนอนุมัติขอเลื่อนบันทึกค่าใช้จ่าย */
export async function ceoUserIds(orgId: string): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { orgId, isActive: true, roles: { some: { role: { code: "CEO" } } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** คำขอเลื่อนบันทึกค่าใช้จ่ายของใบนี้ ล่าสุดก่อน */
export function listExpenseDueRequests(orgId: string, workOrderId: string) {
  return prisma.workOrderDueRequest.findMany({
    where: { orgId, workOrderId, kind: "expense" },
    orderBy: { createdAt: "desc" },
  });
}
