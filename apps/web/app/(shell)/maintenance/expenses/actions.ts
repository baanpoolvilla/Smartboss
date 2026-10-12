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
import { findWorkOrderForPmExpense, getWorkOrder } from "@/modules/maintenance/data/work-orders";
import { getPmSchedule } from "@/modules/maintenance/data/pm";
import { putFile, deleteFiles } from "@/modules/maintenance/lib/storage";

const schema = z.object({
  costType: z.enum(["work_order", "pm"]),
  workOrderId: z.string().optional(),
  pmScheduleId: z.string().optional(),
  paidBy: z.enum(["company", "owner"]).default("company"),
  amount: z.string().optional(),
  description: z.string().trim().max(1000).optional(),
});

export type ExpenseFormState = { error?: string };

/**
 * ปุ่ม "บันทึกค่าใช้จ่าย" / "ไม่มีค่าใช้จ่าย" เป็นคนละ action กัน — เดิมใช้ action เดียว
 * แล้วฝาก isNoExpense=1 ไว้กับตัวปุ่ม (formAction + name/value) ซึ่งค่าไม่ถูกส่งมา
 * ปุ่ม "ไม่มีค่าใช้จ่าย" จึงถูกนับเป็นการบันทึกยอด 0 แล้วถูกทิ้ง
 *
 * ⚠ ห้าม `return` เงียบ ๆ เมื่อข้อมูลไม่ผ่าน — toast กลาง (components/shell/save-feedback.tsx)
 * นับทุกคำตอบที่ไม่ error ว่า "บันทึกสำเร็จ" ผู้ใช้เลยเห็นว่าสำเร็จทั้งที่ไม่มีอะไรถูกบันทึก
 * ต้องคืน { error } ให้ฟอร์มแสดงเสมอ (ฟอร์มปิด toast กลางไว้แล้ว)
 */
export async function createExpenseAction(
  _prev: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  return saveExpense(formData, false);
}

export async function createNoExpenseAction(
  _prev: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  return saveExpense(formData, true);
}

/** "1,500" / "฿ 1,500.50" → 1500.5 — เดิม Number("1,500") ได้ NaN แล้วถูกทิ้งเงียบ ๆ */
function parseAmount(raw: string | undefined): number {
  const clean = (raw ?? "").replace(/[\s,฿]/g, "");
  return clean === "" ? NaN : Number(clean);
}

async function saveExpense(
  formData: FormData,
  isNoExpense: boolean
): Promise<ExpenseFormState> {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.expenseManage)) {
    return { error: "ไม่มีสิทธิ์บันทึกค่าใช้จ่าย" };
  }
  const parsed = schema.safeParse({
    costType: formData.get("costType"),
    workOrderId: (formData.get("workOrderId") as string) || undefined,
    pmScheduleId: (formData.get("pmScheduleId") as string) || undefined,
    paidBy: (formData.get("paidBy") as string) || "company",
    amount: (formData.get("amount") as string) || undefined,
    description: (formData.get("description") as string) || undefined,
  });
  if (!parsed.success) {
    return { error: "ข้อมูลไม่ครบ — ตรวจประเภทค่าใช้จ่ายและรายละเอียด (ไม่เกิน 1,000 ตัวอักษร)" };
  }
  const d = parsed.data;

  let propertyIds: (string | null)[] = [null];
  let workOrderId: string | null = null;
  let pmScheduleId: string | null = null;

  if (d.costType === "work_order") {
    if (!d.workOrderId) return { error: "กรุณาเลือกใบงาน" };
    const wo = await getWorkOrder(s.orgId, d.workOrderId);
    if (!wo) return { error: "ไม่พบใบงานนี้ — อาจถูกลบไปแล้ว" };
    workOrderId = wo.id;
    propertyIds = [wo.propertyId, ...wo.additionalPropertyIds];
  } else {
    if (!d.pmScheduleId) return { error: "กรุณาเลือกรายการ PM" };
    const pm = await getPmSchedule(s.orgId, d.pmScheduleId);
    if (!pm) return { error: "ไม่พบรายการ PM นี้ — อาจถูกลบไปแล้ว" };
    pmScheduleId = pm.id;
    propertyIds = [pm.propertyId ?? null];
    /*
     * มาจากปุ่ม "เพิ่มค่าใช้จ่าย" บนหน้าใบงานที่อุปกรณ์มี PM (?workOrderId=…&pmScheduleId=…)
     * ฟอร์มสลับเป็นประเภท PM ให้เอง — ต้องผูกใบงานด้วย ไม่งั้นค่าใช้จ่ายไปอยู่ที่ PM อย่างเดียว
     * ใบงานค้างคอลัมน์ "ยังไม่บันทึกค่าใช้จ่าย" ทั้งที่บันทึกแล้ว (เจอจริง: WO-2569-0267 ล้างแอร์ ฿4,000)
     */
    if (d.workOrderId) {
      const wo = await getWorkOrder(s.orgId, d.workOrderId);
      if (!wo) return { error: "ไม่พบใบงานนี้ — อาจถูกลบไปแล้ว" };
      workOrderId = wo.id;
      propertyIds = [wo.propertyId, ...wo.additionalPropertyIds];
    } else {
      // บันทึก PM จากหน้าค่าใช้จ่ายเอง — ผูกใบงานที่มาจาก PM นี้ให้อัตโนมัติ (ดู findWorkOrderForPmExpense)
      workOrderId = (await findWorkOrderForPmExpense(s.orgId, pm))?.id ?? null;
    }
  }

  const amount = isNoExpense ? 0 : parseAmount(d.amount);
  if (!isNoExpense && (!Number.isFinite(amount) || amount <= 0)) {
    return {
      error: d.amount
        ? `จำนวนเงิน "${d.amount}" ไม่ถูกต้อง — ใส่เป็นตัวเลขมากกว่า 0`
        : "กรุณาใส่จำนวนเงิน (ถ้าไม่มีค่าใช้จ่าย กดปุ่ม \"ไม่มีค่าใช้จ่าย\")",
    };
  }

  // แนบรูปใบเสร็จ (ข้ามเมื่อบันทึกว่า "ไม่มีค่าใช้จ่าย" เหมือนของเดิม)
  const file = formData.get("receipt");
  const receiptUrl =
    !isNoExpense && file instanceof File && file.size > 0
      ? await putFile(`${s.orgId}/maintenance/receipts`, file)
      : null;

  const saved = await createExpensesForProperties(s.orgId, propertyIds, {
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
  // คำขอซ้ำ — รูปใบเสร็จที่เพิ่งอัปโหลดมากับคำขอนี้ไม่มีรายการไหนใช้
  if (!saved && receiptUrl) await deleteFiles([receiptUrl]).catch(() => 0);

  revalidatePath("/maintenance/expenses");
  // ใบงานที่เพิ่งผูกต้องย้ายออกจาก "ยังไม่บันทึกค่าใช้จ่าย" ทันทีที่กลับไปดู ไม่ค้างของเก่า
  if (workOrderId) {
    revalidatePath("/maintenance/work-orders");
    revalidatePath(`/maintenance/work-orders/${workOrderId}`);
  }
  // เปิดมาจากหน้าใบงาน → กลับไปใบงานนั้น ให้เห็นว่าบันทึกแล้ว · รับเฉพาะ path ใบงานของโมดูลนี้ (กันพาไปเว็บอื่น)
  const returnTo = String(formData.get("returnTo") ?? "");
  redirect(/^\/maintenance\/work-orders\/[\w-]+(\?from=tasks)?$/.test(returnTo) ? returnTo : "/maintenance/expenses");
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
