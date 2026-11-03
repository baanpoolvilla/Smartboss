"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { loadExpenseTracking } from "@/modules/maintenance/data/expense-tracking";
import { trackingActive } from "@/modules/maintenance/lib/expense-deadline";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission, isSuperAdmin } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  createExpensesForProperties,
  deleteExpense,
  getExpense,
} from "@/modules/maintenance/data/expenses";
import { updateExpenseBatch } from "@/modules/maintenance/data/expenses";
import { logActivity } from "@/modules/maintenance/data/activity";
import { addWorkOrderComment, findWorkOrderForPmExpense, getWorkOrder } from "@/modules/maintenance/data/work-orders";
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
  /** ใบงาน/PM ที่ผูก — ไว้เขียนบันทึกการใช้งานให้คนอ่านรู้เรื่อง */
  let target = "";

  if (d.costType === "work_order") {
    if (!d.workOrderId) return { error: "กรุณาเลือกใบงาน" };
    const wo = await getWorkOrder(s.orgId, d.workOrderId);
    if (!wo) return { error: "ไม่พบใบงานนี้ — อาจถูกลบไปแล้ว" };
    workOrderId = wo.id;
    propertyIds = [wo.propertyId, ...wo.additionalPropertyIds];
    target = `${wo.code ?? ""} "${wo.title}"`;
  } else {
    if (!d.pmScheduleId) return { error: "กรุณาเลือกรายการ PM" };
    const pm = await getPmSchedule(s.orgId, d.pmScheduleId);
    if (!pm) return { error: "ไม่พบรายการ PM นี้ — อาจถูกลบไปแล้ว" };
    pmScheduleId = pm.id;
    propertyIds = [pm.propertyId ?? null];
    target = `PM "${pm.title}"`;
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
  const receipt = receiptFields(formData);
  // เปิดใช้กำหนดบันทึกแล้ว ต้องแนบใบเสร็จ หรือติ๊กว่าไม่มี (ผู้ใช้ 3/11/2569)
  if (!isNoExpense && !receipt.noReceipt && !(file instanceof File && file.size > 0) && trackingActive(await loadExpenseTracking(s.orgId))) {
    return { error: "แนบรูปใบเสร็จ หรือติ๊ก \"ไม่มีใบเสร็จ\"" };
  }
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
    ...(isNoExpense ? {} : receipt),
    costType: d.costType,
    paidBy: d.paidBy,
    isNoExpense,
    createdBy: s.userId,
  });
  // คำขอซ้ำ — รูปใบเสร็จที่เพิ่งอัปโหลดมากับคำขอนี้ไม่มีรายการไหนใช้
  if (!saved && receiptUrl) await deleteFiles([receiptUrl]).catch(() => 0);
  if (saved) {
    await logActivity(s.orgId, {
      userId: s.userId,
      entity: "expense",
      entityId: workOrderId ?? pmScheduleId,
      entityCode: target || null,
      action: "create",
      summary: isNoExpense
        ? `บันทึกว่าไม่มีค่าใช้จ่าย ${target}`
        : `บันทึกค่าใช้จ่าย ฿${amount.toLocaleString()} ${target}${propertyIds.length > 1 ? ` (${propertyIds.length} บ้าน)` : ""}`,
      detail: { amount, paidBy: d.paidBy, description: d.description ?? null, receipt: !!receiptUrl, propertyIds },
    });
  }

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

/** ช่องข้อมูลใบเสร็จจากฟอร์ม — ไม่มีใบเสร็จ = เงินสด ถ้ายังไม่ได้เลือกวิธีจ่าย */
function receiptFields(formData: FormData) {
  const text = (k: string, max = 200) => String(formData.get(k) ?? "").trim().slice(0, max) || null;
  const noReceipt = formData.get("noReceipt") === "1";
  const rawAt = text("paidAt", 16);
  const at = rawAt ? new Date(`${rawAt}:00+07:00`) : null;
  return {
    receiptNo: text("receiptNo", 100),
    payee: text("payee"),
    payer: text("payer"),
    paidAt: at && !Number.isNaN(at.getTime()) ? at : null,
    paymentMethod: text("paymentMethod", 20) ?? (noReceipt ? "cash" : null),
    noReceipt,
  };
}

/** แก้รายการที่บันทึกแล้ว — ไม่เลือกรูปใหม่ = ใช้รูปเดิม · ติ๊กไม่มีใบเสร็จ = เอารูปออก */
export async function updateExpenseAction(_prev: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.expenseManage)) return { error: "ไม่มีสิทธิ์แก้ค่าใช้จ่าย" };
  const before = await getExpense(s.orgId, String(formData.get("expenseId") ?? ""));
  if (!before) return { error: "ไม่พบรายการนี้ — อาจถูกลบไปแล้ว" };
  const rawAmount = String(formData.get("amount") ?? "");
  const amount = parseAmount(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "จำนวนเงินต้องเป็นตัวเลขมากกว่า 0" };
  const paidBy = String(formData.get("paidBy") ?? "");
  const receipt = receiptFields(formData);
  const file = formData.get("receipt");
  const newFile = !receipt.noReceipt && file instanceof File && file.size > 0;
  if (!receipt.noReceipt && !newFile && !before.receiptUrl && trackingActive(await loadExpenseTracking(s.orgId))) {
    return { error: "แนบรูปใบเสร็จ หรือติ๊ก \"ไม่มีใบเสร็จ\"" };
  }
  const receiptUrl = receipt.noReceipt ? null : newFile ? await putFile(`${s.orgId}/maintenance/receipts`, file) : before.receiptUrl;
  await updateExpenseBatch(s.orgId, before.id, {
    amount,
    description: String(formData.get("description") ?? "").trim().slice(0, 1000) || null,
    paidBy: paidBy === "owner" ? "owner" : paidBy === "company" ? "company" : before.paidBy,
    receiptUrl,
    ...receipt,
  });
  const wo = before.workOrderId ? await getWorkOrder(s.orgId, before.workOrderId) : null;
  const was = Number(before.amount);
  const change = was === amount ? `฿${amount.toLocaleString()}` : `฿${was.toLocaleString()} → ฿${amount.toLocaleString()}`;
  if (wo) await addWorkOrderComment(s.orgId, wo.id, s.userId, `แก้ไขค่าใช้จ่าย ${change}`, null, { kind: "log" });
  await logActivity(s.orgId, {
    userId: s.userId,
    entity: "expense",
    entityId: before.workOrderId ?? before.pmScheduleId,
    entityCode: wo ? `${wo.code} "${wo.title}"` : null,
    action: "update",
    summary: `แก้ไขค่าใช้จ่าย ${change}${wo ? ` ${wo.code} "${wo.title}"` : ""}`,
    detail: { from: was, to: amount, ...receipt },
  });
  revalidatePath("/maintenance/expenses");
  revalidatePath("/maintenance/work-orders");
  if (wo) revalidatePath(`/maintenance/work-orders/${wo.id}`);
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
  const before = await getExpense(s.orgId, id);
  await deleteExpense(s.orgId, id);
  if (before) {
    const wo = before.workOrderId ? await getWorkOrder(s.orgId, before.workOrderId) : null;
    const target = wo ? `${wo.code ?? ""} "${wo.title}"` : "";
    await logActivity(s.orgId, {
      userId: s.userId,
      entity: "expense",
      entityId: before.workOrderId ?? before.pmScheduleId,
      entityCode: target || null,
      action: "delete",
      summary: `ลบค่าใช้จ่าย ฿${Number(before.amount).toLocaleString()}${before.description ? ` "${before.description}"` : ""} ${target}`.trim(),
      detail: { amount: Number(before.amount), description: before.description, propertyId: before.propertyId },
    });
  }
  revalidatePath("/maintenance/expenses");
}
