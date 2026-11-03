import "server-only";
import { cache } from "react";
import { prisma } from "@smartboss/database";
import type { ExpenseTracking } from "@/modules/maintenance/lib/expense-deadline";
import { realExpenseTotal } from "@/modules/maintenance/lib/expense-batches";
import { deleteActionNotifications, usersWithPermission } from "@/modules/maintenance/data/notify";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { withRequestsTenant } from "@/modules/requests/lib/db";

/** การตั้งค่าของบริษัท — ดู lib/expense-deadline.ts */
export const loadExpenseTracking = cache(async (orgId: string): Promise<ExpenseTracking> => {
  const row = await prisma.performanceSetting.findUnique({
    where: { orgId },
    select: { expenseTrackFrom: true, expenseTrackDays: true, expenseRecorderIds: true },
  });
  return { from: row?.expenseTrackFrom ?? null, days: row?.expenseTrackDays ?? 14, recorderIds: row?.expenseRecorderIds ?? [] };
});

/** PR/PO ที่ยังไม่จบ — จบแล้วระบบลงยอดให้เอง */
const PO_OPEN = ["pending", "approved", "ordered"];
/** ใบเบิกที่จ่ายแล้วลงยอดเข้าใบงานเอง (modules/requests/actions.ts linkMaintenanceExpense) · เบิกล่วงหน้าไม่ลง */
const REQUEST_POSTING_KINDS = ["expense", "contractor"];
const REQUEST_OPEN = ["pending", "approved"];

export interface ExpenseLink {
  /** มี PR/PO หรือใบเบิกยังไม่จบ — ถ้า HR ลงเองตอนนี้ ยอดจะเบิ้ลตอนต้นทางจบ จึงยังไม่เป็นงานและไม่นับเวลา */
  hold: boolean;
  /** ต้นทางจบล่าสุดเมื่อไร (ยกเลิก/ไม่อนุมัติ/รับของแต่ไม่มียอด) — เริ่มนับเวลาจากวันนี้ */
  clockFrom: Date | null;
}

/**
 * สถานะ PR/PO และใบเบิกที่ผูกใบงาน (ผู้ใช้ 3/11/2569 เลือก "เริ่มนับเมื่อต้นทางจบ")
 * ใบเบิกอ่านอย่างเดียว ไม่แก้อะไรของโมดูลเบิกจ่าย · อ่านไม่ได้ให้ throw — ตัวหักคะแนนต้องไม่หักทั้งที่ไม่รู้สถานะ
 */
export async function expenseLinks(orgId: string, workOrderIds: string[]): Promise<Map<string, ExpenseLink>> {
  const out = new Map<string, ExpenseLink>();
  if (workOrderIds.length === 0) return out;
  const touch = (id: string, hold: boolean, at: Date | null) => {
    const cur = out.get(id) ?? { hold: false, clockFrom: null };
    out.set(id, { hold: cur.hold || hold, clockFrom: at && (!cur.clockFrom || at > cur.clockFrom) ? at : cur.clockFrom });
  };
  const pos = await prisma.purchaseOrder.findMany({
    where: { orgId, workOrderId: { in: workOrderIds } },
    select: { workOrderId: true, status: true, updatedAt: true },
  });
  for (const po of pos) touch(po.workOrderId!, PO_OPEN.includes(po.status), PO_OPEN.includes(po.status) ? null : po.updatedAt);
  const reqs = await withRequestsTenant(orgId, (tx) =>
    tx.moneyRequest.findMany({
      where: { orgId, workOrderId: { in: workOrderIds }, kind: { in: REQUEST_POSTING_KINDS } },
      select: { workOrderId: true, status: true, updatedAt: true },
    }),
  );
  for (const r of reqs) touch(r.workOrderId!, REQUEST_OPEN.includes(r.status), REQUEST_OPEN.includes(r.status) ? null : r.updatedAt);
  return out;
}

/** ใบค้างบันทึกของบริษัท เก่าสุดก่อน (ไม่นับใบที่รอต้นทาง) — ใช้ใน cron ได้ ไม่ผูก cache ต่อคำขอ */
export async function queryPendingExpenseOrders(orgId: string) {
  const rows = await prisma.expense.findMany({ where: { orgId, workOrderId: { not: null } }, select: { workOrderId: true }, distinct: ["workOrderId"] });
  const withExpense = rows.map((r) => r.workOrderId).filter((x): x is string => !!x);
  const orders = await prisma.workOrder.findMany({
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
  const links = await expenseLinks(orgId, orders.map((o) => o.id));
  return orders.filter((o) => !links.get(o.id)?.hold).map((o) => ({ ...o, clockFrom: links.get(o.id)?.clockFrom ?? null }));
}

/** ตัวเดียวกันแบบ cache ต่อคำขอ สำหรับหน้าเว็บ — อ่านสถานะต้นทางไม่ได้ ไม่ให้ทุกหน้าของผู้บันทึกล่ม */
export const pendingExpenseWorkOrders = cache(async (orgId: string) => {
  try {
    return await queryPendingExpenseOrders(orgId);
  } catch (error) {
    console.error("[expense-tracking] pending", error);
    return [];
  }
});

/** ผู้บันทึกกลับมาตรวจ/แก้ใบที่บันทึกแล้วได้กี่วัน นับจากวันบันทึก — เก่ากว่านี้ไปที่หน้าค่าใช้จ่าย */
export const EXPENSE_RECORDED_VISIBLE_DAYS = 30;

/**
 * ใบที่ปิดแล้วและบันทึกค่าใช้จ่ายภายใน 30 วัน พร้อมยอดจ่ายจริงและวันบันทึกล่าสุด
 * (ผู้ใช้ 3/11/2569 "ต้องขึ้นบอกเราว่าใบไหนบันทึกเสร็จ เพื่อเค้ามาแก้")
 */
export const recordedExpenseWorkOrders = cache(async (orgId: string) => {
  const since = new Date(Date.now() - EXPENSE_RECORDED_VISIBLE_DAYS * 86_400_000);
  const recent = await prisma.expense.findMany({
    where: { orgId, workOrderId: { not: null }, createdAt: { gte: since } },
    select: { workOrderId: true },
    distinct: ["workOrderId"],
  });
  const ids = recent.map((r) => r.workOrderId!);
  if (ids.length === 0) return [];
  const done = await prisma.workOrder.findMany({
    where: { orgId, id: { in: ids }, status: "completed", isPrivate: false },
    select: { id: true },
  });
  const rows = await prisma.expense.findMany({
    where: { orgId, workOrderId: { in: done.map((w) => w.id) } },
    select: { workOrderId: true, createdBy: true, amount: true, description: true, createdAt: true },
  });
  return done.map((w) => {
    const mine = rows.filter((r) => r.workOrderId === w.id);
    return {
      id: w.id,
      total: realExpenseTotal(mine),
      at: mine.reduce((max, r) => (r.createdAt > max ? r.createdAt : max), new Date(0)),
    };
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

/** ผู้บันทึกที่ทำงานได้จริง: บัญชียังใช้งานและยังมีสิทธิ์บันทึก — คนถูกถอนสิทธิ์ทำไม่ได้ จึงต้องไม่โดนหัก */
export async function workingRecorders(orgId: string, recorderIds: string[]): Promise<string[]> {
  if (recorderIds.length === 0) return [];
  const can = new Set(await usersWithPermission(orgId, MAINT_PERMS.expenseManage));
  return recorderIds.filter((id) => can.has(id));
}

const EXPENSE_REQUEST_TITLE = "ขอเลื่อนบันทึกค่าใช้จ่าย รออนุมัติ";

/** ปิดคำขอเลื่อนที่ค้าง + ลบ "รออนุมัติ" ออกจากกระดิ่ง CEO — ใบนี้ไม่มีอะไรให้อนุมัติแล้ว */
export async function closeExpenseRequests(orgId: string, workOrderId: string, note: string): Promise<number> {
  const pending = await prisma.workOrderDueRequest.findMany({ where: { orgId, workOrderId, kind: "expense", status: "pending" } });
  for (const r of pending) {
    await prisma.workOrderDueRequest.updateMany({ where: { orgId, id: r.id, status: "pending" }, data: { status: "cancelled", decidedAt: new Date(), decisionNote: note } });
    await deleteActionNotifications(workOrderId, "work_order", [EXPENSE_REQUEST_TITLE], r.createdAt);
  }
  return pending.length;
}

/** กวาดคำขอของใบที่ไม่รอบันทึกแล้ว — ใบที่ PR/PO หรือใบเบิกลงยอดให้ ไม่ได้ผ่านหน้าบันทึกของแจ้งซ่อม */
export async function closeStaleExpenseRequests(orgId: string, pendingWorkOrderIds: string[]): Promise<number> {
  const stale = await prisma.workOrderDueRequest.findMany({
    where: { orgId, kind: "expense", status: "pending", workOrderId: { notIn: pendingWorkOrderIds } },
    select: { workOrderId: true },
    distinct: ["workOrderId"],
  });
  let closed = 0;
  for (const s of stale) closed += await closeExpenseRequests(orgId, s.workOrderId, "ใบนี้ไม่รอบันทึกแล้ว");
  return closed;
}

/** ใบเบิกที่ลงรายการค่าใช้จ่ายเหล่านี้ — รายการจากใบเบิกแก้ที่ต้นทาง ไม่แก้ที่แจ้งซ่อม */
export async function requestsOfExpenses(orgId: string, expenseIds: string[]): Promise<Map<string, { id: string; code: string }>> {
  if (expenseIds.length === 0) return new Map();
  const rows = await withRequestsTenant(orgId, (tx) =>
    tx.moneyRequest.findMany({ where: { orgId, maintenanceExpenseId: { in: expenseIds } }, select: { id: true, code: true, maintenanceExpenseId: true } }),
  ).catch((error: unknown) => {
    console.error("[expense-tracking] requestsOfExpenses", error);
    return [];
  });
  return new Map(rows.map((r) => [r.maintenanceExpenseId!, { id: r.id, code: r.code }]));
}

/** รายการนี้ลงมาจาก PR/PO หรือใบเบิก — แก้ที่แจ้งซ่อมแล้วยอดจะไม่ตรงต้นทาง */
export function expenseHasSource(e: { purchaseOrderId: string | null; category: string | null }): boolean {
  return !!e.purchaseOrderId || e.category === "เบิกจ่าย";
}

/**
 * รูปนี้เคยใช้ที่อื่นไหม — เตือนอย่างเดียว ไม่บล็อก (บิลใบเดียวครอบหลายงานได้จริง)
 * ดูทั้งค่าใช้จ่ายใบงานอื่น และใบเบิก (อ่านอย่างเดียว ลายนิ้วมือแบบเดียวกับ modules/requests/actions.ts usedHashes)
 */
export async function receiptUsedElsewhere(orgId: string, sha: string, exceptWorkOrderId: string | null): Promise<string | null> {
  const exp = await prisma.expense.findFirst({
    where: { orgId, receiptSha256: sha, ...(exceptWorkOrderId ? { NOT: { workOrderId: exceptWorkOrderId } } : {}) },
    select: { workOrderId: true, description: true },
  });
  if (exp) {
    const wo = exp.workOrderId ? await prisma.workOrder.findFirst({ where: { orgId, id: exp.workOrderId }, select: { code: true } }) : null;
    return wo?.code ?? exp.description ?? "ค่าใช้จ่ายอื่น";
  }
  const draft = await prisma.workOrder.findFirst({
    where: { orgId, expenseDraft: { path: ["receiptSha256"], equals: sha }, ...(exceptWorkOrderId ? { NOT: { id: exceptWorkOrderId } } : {}) },
    select: { code: true },
  });
  if (draft) return draft.code;
  try {
    const rows = await withRequestsTenant(orgId, (tx) =>
      tx.$queryRawUnsafe<{ code: string }[]>(
        `SELECT r.code FROM requests.requests r, jsonb_array_elements(r.attachments) a
          WHERE r.org_id = $1 AND r.status NOT IN ('rejected', 'cancelled') AND a->>'sha256' = $2 LIMIT 1`,
        orgId,
        sha,
      ),
    );
    return rows[0]?.code ?? null;
  } catch (error) {
    console.error("[expense-tracking] receiptUsedElsewhere", error);
    return null;
  }
}
