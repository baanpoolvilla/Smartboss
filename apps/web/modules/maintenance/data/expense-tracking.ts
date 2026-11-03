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

/** ผู้บันทึกกลับมาตรวจ/แก้ใบที่บันทึกแล้วได้กี่วัน นับจากวันบันทึก — เก่ากว่านี้ไปที่หน้าค่าใช้จ่าย */
export const EXPENSE_RECORDED_VISIBLE_DAYS = 30;

/**
 * ใบที่ปิดแล้วและบันทึกค่าใช้จ่ายภายใน 30 วัน พร้อมยอดรวมและวันบันทึกล่าสุด
 * (ผู้ใช้ 3/11/2569 "ต้องขึ้นบอกเราว่าใบไหนบันทึกเสร็จ เพื่อเค้ามาแก้")
 */
export const recordedExpenseWorkOrders = cache(async (orgId: string) => {
  const since = new Date(Date.now() - EXPENSE_RECORDED_VISIBLE_DAYS * 86_400_000);
  const rows = await prisma.expense.findMany({
    where: { orgId, workOrderId: { not: null }, createdAt: { gte: since } },
    select: { workOrderId: true, amount: true, createdAt: true },
  });
  const ids = [...new Set(rows.map((r) => r.workOrderId!))];
  if (ids.length === 0) return [];
  const open = await prisma.workOrder.findMany({
    where: { orgId, id: { in: ids }, status: "completed", isPrivate: false },
    select: { id: true },
  });
  const keep = new Set(open.map((w) => w.id));
  const out = new Map<string, { id: string; total: number; at: Date }>();
  for (const r of rows) {
    const id = r.workOrderId!;
    if (!keep.has(id)) continue;
    const cur = out.get(id);
    out.set(id, { id, total: (cur?.total ?? 0) + Number(r.amount), at: cur && cur.at > r.createdAt ? cur.at : r.createdAt });
  }
  return [...out.values()];
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
