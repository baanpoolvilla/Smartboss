import "server-only";
import { prisma } from "@smartboss/database";

export interface ExpenseFilters {
  workOrderId?: string;
  pmScheduleId?: string;
  purchaseOrderId?: string;
  propertyId?: string;
  from?: Date;
  to?: Date;
}

/** ค่าใช้จ่ายตามตัวกรอง (port จาก getExpenses ของ SupabaseService) */
export function listExpenses(orgId: string, f: ExpenseFilters = {}) {
  return prisma.expense.findMany({
    where: {
      orgId,
      ...(f.workOrderId ? { workOrderId: f.workOrderId } : {}),
      ...(f.pmScheduleId ? { pmScheduleId: f.pmScheduleId } : {}),
      ...(f.purchaseOrderId ? { purchaseOrderId: f.purchaseOrderId } : {}),
      ...(f.propertyId ? { propertyId: f.propertyId } : {}),
      ...(f.from || f.to
        ? {
            expenseDate: {
              ...(f.from ? { gte: f.from } : {}),
              ...(f.to ? { lt: f.to } : {}),
            },
          }
        : {}),
    },
    orderBy: { expenseDate: "desc" },
  });
}

export function listExpensesForMonth(orgId: string, year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return prisma.expense.findMany({
    where: { orgId, expenseDate: { gte: start, lt: end } },
    orderBy: { expenseDate: "desc" },
  });
}

export interface ExpenseInput {
  workOrderId?: string | null;
  pmScheduleId?: string | null;
  purchaseOrderId?: string | null;
  propertyId?: string | null;
  amount: number;
  description?: string | null;
  category?: string | null;
  receiptUrl?: string | null;
  costType: string; // work_order | pm
  paidBy: string; // company | owner
  isNoExpense?: boolean;
  expenseDate?: Date;
  createdBy?: string | null;
}

export function createExpense(orgId: string, data: ExpenseInput) {
  return prisma.expense.create({
    data: {
      orgId,
      workOrderId: data.workOrderId ?? null,
      pmScheduleId: data.pmScheduleId ?? null,
      purchaseOrderId: data.purchaseOrderId ?? null,
      propertyId: data.propertyId ?? null,
      amount: data.amount,
      description: data.description ?? null,
      category: data.category ?? null,
      receiptUrl: data.receiptUrl ?? null,
      costType: data.costType,
      paidBy: data.paidBy,
      isNoExpense: data.isNoExpense ?? false,
      expenseDate: data.expenseDate ?? new Date(),
      createdBy: data.createdBy ?? null,
    },
  });
}

/** สร้าง expense หลายรายการพร้อมกัน (ใบงานหลายบ้าน = 1 รายการ/บ้าน) */
export async function createExpensesForProperties(
  orgId: string,
  propertyIds: (string | null)[],
  base: Omit<ExpenseInput, "propertyId">
) {
  const ids = propertyIds.length > 0 ? propertyIds : [null];
  await prisma.$transaction(
    ids.map((pid) =>
      prisma.expense.create({
        data: {
          orgId,
          workOrderId: base.workOrderId ?? null,
          pmScheduleId: base.pmScheduleId ?? null,
          purchaseOrderId: base.purchaseOrderId ?? null,
          propertyId: pid,
          amount: base.amount,
          description: base.description ?? null,
          category: base.category ?? null,
          receiptUrl: base.receiptUrl ?? null,
          costType: base.costType,
          paidBy: base.paidBy,
          isNoExpense: base.isNoExpense ?? false,
          expenseDate: base.expenseDate ?? new Date(),
          createdBy: base.createdBy ?? null,
        },
      })
    )
  );
}

export async function deleteExpense(orgId: string, id: string) {
  await prisma.expense.deleteMany({ where: { orgId, id } });
}
