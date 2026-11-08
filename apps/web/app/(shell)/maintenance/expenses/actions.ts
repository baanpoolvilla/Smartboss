"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma, Prisma } from "@smartboss/database";
import { receiptDataFromForm } from "@/modules/maintenance/lib/receipt-read";
import { revalidatePath } from "next/cache";
import { closeExpenseRequests, expenseHasSource, loadExpenseTracking } from "@/modules/maintenance/data/expense-tracking";
import { trackingActive } from "@/modules/maintenance/lib/expense-deadline";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission, isSuperAdmin } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  createExpensesForProperties,
  deleteExpense,
  getExpense,
} from "@/modules/maintenance/data/expenses";
import { expenseTaxColumns, updateExpenseBatch, type ExpenseTaxInput } from "@/modules/maintenance/data/expenses";
import { loadSettings as loadRequestSettings } from "@/modules/requests/lib/data";
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

/** เพดานคอลัมน์ amount Decimal(12,2) — เกินแล้วฐานข้อมูลโยน error หน้าจอไม่บอกสาเหตุ */
const MAX_EXPENSE = 9_999_999_999.99;

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
  /** ใบงานที่ผูก — เอาวันปิดงานกับสิ่งที่ช่างแนบมาใช้ */
  let linkedWo: Awaited<ReturnType<typeof getWorkOrder>> = null;
  /** ใบงาน/PM ที่ผูก — ไว้เขียนบันทึกการใช้งานให้คนอ่านรู้เรื่อง */
  let target = "";

  if (d.costType === "work_order") {
    if (!d.workOrderId) return { error: "กรุณาเลือกใบงาน" };
    const wo = await getWorkOrder(s.orgId, d.workOrderId);
    if (!wo) return { error: "ไม่พบใบงานนี้ — อาจถูกลบไปแล้ว" };
    linkedWo = wo;
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
      linkedWo = wo;
      workOrderId = wo.id;
      propertyIds = [wo.propertyId, ...wo.additionalPropertyIds];
    } else {
      // บันทึก PM จากหน้าค่าใช้จ่ายเอง — ผูกใบงานที่มาจาก PM นี้ให้อัตโนมัติ (ดู findWorkOrderForPmExpense)
      workOrderId = (await findWorkOrderForPmExpense(s.orgId, pm))?.id ?? null;
    }
  }

  const amount = isNoExpense ? 0 : parseAmount(d.amount);
  if (!isNoExpense && amount > MAX_EXPENSE) return { error: "จำนวนเงินเกินกว่าที่ระบบรับได้ ตรวจว่าพิมพ์เลขถูกไหม" };
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
  if (!isNoExpense && file instanceof File && file.size > 0 && !file.type.startsWith("image/")) {
    return { error: "แนบได้เฉพาะไฟล์รูป" };
  }
  const newFile = !isNoExpense && !receipt.noReceipt && file instanceof File && file.size > 0;
  // รูปที่ช่างแนบตอนปิดงาน — อ่านจากใบงาน ไม่เชื่อ URL จากฟอร์ม
  const draft = (linkedWo?.expenseDraft ?? null) as { receiptUrl?: string | null; receiptSha256?: string | null; ai?: unknown } | null;
  const draftUrl = !isNoExpense && !receipt.noReceipt && !newFile ? (draft?.receiptUrl ?? null) : null;
  // เปิดใช้กำหนดบันทึกแล้ว ต้องแนบใบเสร็จ หรือติ๊กว่าไม่มี (ผู้ใช้ 3/11/2569)
  const tracked = trackingActive(await loadExpenseTracking(s.orgId));
  if (!isNoExpense && !receipt.noReceipt && !newFile && !draftUrl && tracked) {
    return { error: "แนบรูปใบเสร็จ หรือติ๊ก \"ไม่มีใบเสร็จ\"" };
  }
  // ระหว่างเปิดฟอร์มค้าง มีคนอื่นลงยอดใบนี้แล้ว (ผู้บันทึกอีกคน / PR/PO / ใบเบิก) — บันทึกต่อยอดจะเบิ้ล
  const expected = formData.get("expectedExpenses");
  if (tracked && workOrderId && expected !== null && (await prisma.expense.count({ where: { orgId: s.orgId, workOrderId } })) !== Number(expected)) {
    return { error: "ระหว่างที่เปิดหน้านี้ มีการลงค่าใช้จ่ายของใบงานนี้แล้ว กลับไปดูที่ใบงานก่อน ไม่งั้นยอดจะเบิ้ล" };
  }
  // ใบงานหลายบ้าน: ลงยอดจริงของแต่ละบ้าน (ผู้ใช้ 3/11/2569 "เอาให้ราคาตามจริง แจกแจงชัดเจน") ชื่อบ้านอยู่ในรายละเอียด
  // เพื่อให้ยอดเท่ากันไม่ถูกรวมเป็นชุดเดียวกับรายการเก่าที่ลงยอดเต็มทุกบ้าน
  let split: Map<string, { amount: number; description: string }> | null = null;
  if (!isNoExpense && propertyIds.length > 1) {
    const ids = formData.getAll("houseId").map(String);
    const amounts = formData.getAll("houseAmount").map((x) => parseAmount(String(x || "0")));
    if (ids.length !== propertyIds.length || ids.some((id) => !propertyIds.includes(id))) return { error: "ใบงานนี้มีหลายบ้าน กรอกยอดจริงของแต่ละบ้าน" };
    if (amounts.some((x) => !Number.isFinite(x) || x < 0)) return { error: "ยอดของแต่ละบ้านต้องเป็นตัวเลข" };
    const sum = amounts.reduce((n, x) => n + x, 0);
    if (Math.abs(sum - amount) > 0.005) return { error: `ยอดแยกบ้านรวม ฿${sum.toLocaleString()} ไม่ตรงกับยอดรวม ฿${amount.toLocaleString()}` };
    const homes = await prisma.property.findMany({ where: { orgId: s.orgId, id: { in: ids } }, select: { id: true, name: true } });
    split = new Map(
      ids.flatMap((id, i) => {
        const name = homes.find((h) => h.id === id)?.name ?? "-";
        return amounts[i]! > 0 ? [[id, { amount: amounts[i]!, description: d.description ? `${d.description} · ${name}` : name }] as const] : [];
      }),
    );
  }
  if (!isNoExpense && formData.get("costKind") === "service" && amount >= 1000 && !String(formData.get("payee") ?? "").trim()) {
    return { error: "ค่าแรง/ค่าบริการตั้งแต่ 1,000 บาท ใส่ด้วยว่าจ่ายให้ใคร" };
  }
  const receiptUrl = newFile ? await putFile(`${s.orgId}/maintenance/receipts`, file) : draftUrl;
  const receiptSha256 = newFile ? createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex") : draftUrl ? (draft?.receiptSha256 ?? null) : null;
  const receiptAi = isNoExpense ? null : (parseAi(formData.get("receiptAi")) ?? (draftUrl ? ((draft?.ai ?? null) as Prisma.InputJsonValue | null) : null));

  const firstSplit = split ? [...split.values()][0]! : null;
  const saved = await createExpensesForProperties(s.orgId, split ? [...split.keys()] : propertyIds, {
    workOrderId,
    pmScheduleId,
    amount: firstSplit ? firstSplit.amount : amount,
    description: firstSplit
      ? firstSplit.description
      : isNoExpense
        ? d.description || "ไม่มีค่าใช้จ่าย"
        : (d.description ?? null),
    receiptUrl,
    ...(isNoExpense ? {} : receipt),
    receiptSha256,
    receiptAi,
    // เปิดใช้แล้ว นับเดือนตามวันบนใบเสร็จ ไม่มีใช้วันปิดงาน (ผู้ใช้ 3/11/2569) · ปิดอยู่ = วันที่บันทึกเหมือนเดิม
    ...(tracked ? { expenseDate: monthDate(receipt.paidAt, linkedWo?.completedAt ?? null) } : {}),
    costType: d.costType,
    paidBy: d.paidBy,
    isNoExpense,
    createdBy: s.userId,
    ...(isNoExpense ? {} : await taxFields(formData, s.orgId)),
  }, split ?? undefined);
  // คำขอซ้ำ — รูปใบเสร็จที่เพิ่งอัปโหลดมากับคำขอนี้ไม่มีรายการไหนใช้
  if (!saved && newFile && receiptUrl) await deleteFiles([receiptUrl]).catch(() => 0);
  if (saved) {
    // บันทึกแล้ว คำขอเลื่อนที่ค้างไม่มีอะไรให้ CEO อนุมัติ
    if (workOrderId) await closeExpenseRequests(s.orgId, workOrderId, "บันทึกค่าใช้จ่ายแล้ว");
    // ลงยอดแล้ว ของที่ช่างกรอกหมดหน้าที่ — ไม่ล้าง "เพิ่มรายการ" จะเติมยอดเดิมมาให้ลงซ้ำ
    if (workOrderId && linkedWo?.expenseDraft) {
      await prisma.workOrder.updateMany({ where: { orgId: s.orgId, id: workOrderId }, data: { expenseDraft: Prisma.DbNull } });
    }
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

/**
 * ค่าของ / ค่าแรง-ค่าบริการ + ภาษี (ผู้ใช้ 8/11/2569) — ฟอร์มไม่ส่ง costKind = แบบเดิม (ไม่แตะคอลัมน์ภาษี)
 * VAT % ตามตั้งค่าเบิกจ่าย & OT (ที่เดียวกับเงินสดย่อย/ใบค่าช่าง) · หัก ณ ที่จ่ายคิดจากยอดก่อน VAT
 */
async function taxFields(formData: FormData, orgId: string): Promise<{ costKind?: "goods" | "service"; payeeKind?: "person" | "company" | null; tax?: ExpenseTaxInput | null }> {
  const kind = String(formData.get("costKind") ?? "");
  if (kind !== "goods" && kind !== "service") return {};
  if (kind === "goods") return { costKind: "goods", payeeKind: null, tax: null };
  const pk = String(formData.get("payeeKind") ?? "");
  const vatIncluded = formData.get("vatIncluded") === "1";
  const wht = Number(formData.get("whtPercent") ?? 0);
  const whtPercent = Number.isFinite(wht) && wht > 0 && wht <= 15 ? Math.round(wht * 100) / 100 : 0;
  const vatPercent = vatIncluded ? (await loadRequestSettings(orgId)).vatPercent : 0;
  return { costKind: "service", payeeKind: pk === "person" || pk === "company" ? pk : null, tax: vatIncluded || whtPercent ? { vatIncluded, vatPercent, whtPercent } : null };
}

/** วันที่ลงบัญชี (คอลัมน์วันล้วน เวลาไทย): วันบนใบเสร็จ → วันปิดงาน → วันนี้ */
function monthDate(paidAt: Date | null, completedAt: Date | null): Date {
  const d = paidAt ?? completedAt ?? new Date();
  return new Date(`${new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/** ค่าที่ AI อ่านจากฟอร์ม — เก็บไว้เทียบกับค่าที่คนแก้เท่านั้น ไม่ได้ใช้คำนวณ */
function parseAi(v: FormDataEntryValue | null): Prisma.InputJsonValue | null {
  if (typeof v !== "string" || !v || v.length > 2000) return null;
  try {
    return receiptDataFromForm(v) as unknown as Prisma.InputJsonValue;
  } catch {
    return null;
  }
}

/** แก้รายการที่บันทึกแล้ว — ไม่เลือกรูปใหม่ = ใช้รูปเดิม · ติ๊กไม่มีใบเสร็จ = เอารูปออก */
export async function updateExpenseAction(_prev: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.expenseManage)) return { error: "ไม่มีสิทธิ์แก้ค่าใช้จ่าย" };
  const before = await getExpense(s.orgId, String(formData.get("expenseId") ?? ""));
  if (!before) return { error: "ไม่พบรายการนี้ — อาจถูกลบไปแล้ว" };
  if (expenseHasSource(before)) return { error: "รายการนี้มาจาก PR/PO หรือใบเบิก — แก้ที่ต้นทาง ไม่งั้นยอดจะไม่ตรงกัน" };
  const rawAmount = String(formData.get("amount") ?? "");
  const amount = parseAmount(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "จำนวนเงินต้องเป็นตัวเลขมากกว่า 0" };
  if (amount > MAX_EXPENSE) return { error: "จำนวนเงินเกินกว่าที่ระบบรับได้ ตรวจว่าพิมพ์เลขถูกไหม" };
  const paidBy = String(formData.get("paidBy") ?? "");
  const receipt = receiptFields(formData);
  const file = formData.get("receipt");
  if (file instanceof File && file.size > 0 && !file.type.startsWith("image/")) return { error: "แนบได้เฉพาะไฟล์รูป" };
  const newFile = !receipt.noReceipt && file instanceof File && file.size > 0;
  if (!receipt.noReceipt && !newFile && !before.receiptUrl && trackingActive(await loadExpenseTracking(s.orgId))) {
    return { error: "แนบรูปใบเสร็จ หรือติ๊ก \"ไม่มีใบเสร็จ\"" };
  }
  const receiptUrl = receipt.noReceipt ? null : newFile ? await putFile(`${s.orgId}/maintenance/receipts`, file) : before.receiptUrl;
  const tracked = trackingActive(await loadExpenseTracking(s.orgId));
  await updateExpenseBatch(s.orgId, before.id, {
    amount,
    description: String(formData.get("description") ?? "").trim().slice(0, 1000) || null,
    paidBy: paidBy === "owner" ? "owner" : paidBy === "company" ? "company" : before.paidBy,
    receiptUrl,
    ...receipt,
    ...(newFile ? { receiptSha256: createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex"), receiptAi: parseAi(formData.get("receiptAi")) ?? undefined } : {}),
    ...(receipt.noReceipt ? { receiptSha256: null } : {}),
    // แก้วันบนใบเสร็จ = ย้ายเดือนตาม · ไม่มีวันเดิมไว้
    ...(tracked && receipt.paidAt ? { expenseDate: monthDate(receipt.paidAt, null) } : {}),
    ...(await (async () => {
      const t = await taxFields(formData, s.orgId);
      if (!t.costKind) return {};
      const c = expenseTaxColumns(amount, t.costKind, t.payeeKind, t.tax) as { vatAmount?: number | null; whtPercent?: number | null; whtAmount?: number | null };
      return { costKind: t.costKind, payeeKind: t.payeeKind ?? null, vatAmount: c.vatAmount ?? null, whtPercent: c.whtPercent ?? null, whtAmount: c.whtAmount ?? null };
    })()),
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
