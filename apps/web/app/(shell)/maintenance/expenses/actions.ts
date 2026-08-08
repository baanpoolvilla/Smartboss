"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission, isSuperAdmin } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  createExpensesForProperties,
  deleteExpense,
} from "@/modules/maintenance/data/expenses";
import { getWorkOrder } from "@/modules/maintenance/data/work-orders";
import { getPmSchedule } from "@/modules/maintenance/data/pm";
import { putFile } from "@/modules/maintenance/lib/storage";

const schema = z.object({
  costType: z.enum(["work_order", "pm"]),
  workOrderId: z.string().optional(),
  pmScheduleId: z.string().optional(),
  paidBy: z.enum(["company", "owner"]).default("company"),
  amount: z.string().optional(),
  description: z.string().trim().max(1000).optional(),
});

export async function createExpenseAction(formData: FormData) {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.expenseManage)) {
    throw new Error("ไม่มีสิทธิ์บันทึกค่าใช้จ่าย");
  }
  const isNoExpense = formData.get("isNoExpense") === "1";
  const parsed = schema.safeParse({
    costType: formData.get("costType"),
    workOrderId: (formData.get("workOrderId") as string) || undefined,
    pmScheduleId: (formData.get("pmScheduleId") as string) || undefined,
    paidBy: (formData.get("paidBy") as string) || "company",
    amount: (formData.get("amount") as string) || undefined,
    description: (formData.get("description") as string) || undefined,
  });
  if (!parsed.success) return;
  const d = parsed.data;

  let propertyIds: (string | null)[] = [null];
  let workOrderId: string | null = null;
  let pmScheduleId: string | null = null;

  if (d.costType === "work_order") {
    if (!d.workOrderId) return;
    workOrderId = d.workOrderId;
    const wo = await getWorkOrder(s.orgId, d.workOrderId);
    if (wo) propertyIds = [wo.propertyId, ...wo.additionalPropertyIds];
  } else {
    if (!d.pmScheduleId) return;
    pmScheduleId = d.pmScheduleId;
    const pm = await getPmSchedule(s.orgId, d.pmScheduleId);
    propertyIds = [pm?.propertyId ?? null];
  }

  const amount = isNoExpense ? 0 : Number(d.amount ?? "0");
  if (!isNoExpense && (!Number.isFinite(amount) || amount <= 0)) return;

  // แนบรูปใบเสร็จ (ข้ามเมื่อบันทึกว่า "ไม่มีค่าใช้จ่าย" เหมือนของเดิม)
  const file = formData.get("receipt");
  const receiptUrl =
    !isNoExpense && file instanceof File && file.size > 0
      ? await putFile("maintenance/receipts", file)
      : null;

  await createExpensesForProperties(s.orgId, propertyIds, {
    workOrderId,
    pmScheduleId,
    amount,
    description: isNoExpense
      ? d.description || "ไม่มีค่าใช้จ่าย"
      : (d.description ?? null),
    receiptUrl,
    costType: d.costType,
    paidBy: d.paidBy,
    isNoExpense,
    createdBy: s.userId,
  });

  revalidatePath("/maintenance/expenses");
  redirect("/maintenance/expenses");
}

export async function deleteExpenseAction(formData: FormData) {
  const s = await requireOrg();
  if (!isSuperAdmin(s)) {
    throw new Error("เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่ลบได้");
  }
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteExpense(s.orgId, id);
  revalidatePath("/maintenance/expenses");
}
