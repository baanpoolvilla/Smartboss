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
  receiptNo?: string | null;
  payee?: string | null;
  payer?: string | null;
  paidAt?: Date | null;
  paymentMethod?: string | null;
  noReceipt?: boolean;
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
      receiptNo: data.receiptNo ?? null,
      payee: data.payee ?? null,
      payer: data.payer ?? null,
      paidAt: data.paidAt ?? null,
      paymentMethod: data.paymentMethod ?? null,
      noReceipt: data.noReceipt ?? false,
      costType: data.costType,
      paidBy: data.paidBy,
      isNoExpense: data.isNoExpense ?? false,
      expenseDate: data.expenseDate ?? new Date(),
      createdBy: data.createdBy ?? null,
    },
  });
}

/** สร้าง expense หลายรายการพร้อมกัน (ใบงานหลายบ้าน = 1 รายการ/บ้าน) */
/**
 * คืน false เมื่อเป็นคำขอซ้ำ (ไม่ได้บันทึก): คนเดิมเพิ่งบันทึกรายการเดียวกันเป๊ะ
 * (ใบงาน/PM เดิม ยอดเดิม คำอธิบายเดิม) ภายใน 2 นาที — กดบันทึกซ้ำตอนอัปโหลดใบเสร็จช้า
 * แล้วยอดค่าใช้จ่ายเบิ้ล
 */
export async function createExpensesForProperties(
  orgId: string,
  propertyIds: (string | null)[],
  base: Omit<ExpenseInput, "propertyId">
): Promise<boolean> {
  const ids = propertyIds.length > 0 ? propertyIds : [null];
  return prisma.$transaction(async (tx) => {
    if (base.createdBy) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`expense-create:${orgId}:${base.createdBy}`}))`;
      const recent = await tx.expense.findFirst({
        where: {
          orgId,
          createdBy: base.createdBy,
          workOrderId: base.workOrderId ?? null,
          pmScheduleId: base.pmScheduleId ?? null,
          amount: base.amount,
          description: base.description ?? null,
          isNoExpense: base.isNoExpense ?? false,
          createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (recent) return false;
    }
    for (const pid of ids) {
      await tx.expense.create({
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
          receiptNo: base.receiptNo ?? null,
          payee: base.payee ?? null,
          payer: base.payer ?? null,
          paidAt: base.paidAt ?? null,
          paymentMethod: base.paymentMethod ?? null,
          noReceipt: base.noReceipt ?? false,
          costType: base.costType,
          paidBy: base.paidBy,
          isNoExpense: base.isNoExpense ?? false,
          expenseDate: base.expenseDate ?? new Date(),
          createdBy: base.createdBy ?? null,
        },
      });
    }
    return true;
  });
}

/**
 * แก้รายการที่บันทึกแล้ว — ใบงานหลายบ้านบันทึกไว้บ้านละแถว (createExpensesForProperties) แก้พร้อมกันทุกแถวของชุดนั้น
 * ชุดเดียวกัน = ใบงาน คนบันทึก ยอด คำอธิบายเดียวกัน บันทึกห่างกันไม่เกิน 10 วินาที
 */
export async function updateExpenseBatch(
  orgId: string,
  id: string,
  data: {
    amount: number;
    description: string | null;
    paidBy: string;
    receiptUrl: string | null;
    receiptNo: string | null;
    payee: string | null;
    payer: string | null;
    paidAt: Date | null;
    paymentMethod: string | null;
    noReceipt: boolean;
  },
): Promise<void> {
  const row = await prisma.expense.findFirst({ where: { orgId, id } });
  if (!row) return;
  const where = row.workOrderId
    ? {
        orgId,
        workOrderId: row.workOrderId,
        createdBy: row.createdBy,
        amount: row.amount,
        description: row.description,
        createdAt: { gte: new Date(row.createdAt.getTime() - 10_000), lte: new Date(row.createdAt.getTime() + 10_000) },
      }
    : { orgId, id };
  await prisma.expense.updateMany({ where, data: { ...data, isNoExpense: false } });
}

export async function deleteExpense(orgId: string, id: string) {
  await prisma.expense.deleteMany({ where: { orgId, id } });
}

export function getExpense(orgId: string, id: string) {
  return prisma.expense.findFirst({ where: { orgId, id } });
}
