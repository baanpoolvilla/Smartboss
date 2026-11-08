"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@smartboss/database";
import { hasRole, isSuperAdmin, requireOrg } from "@smartboss/auth";
import { addWorkOrderComment, getWorkOrder, updateWorkOrder } from "@/modules/maintenance/data/work-orders";
import { deleteActionNotifications, notifyActorName, notifyUser, notifyUsers, resolveActionNotifications } from "@/modules/maintenance/data/notify";
import { logActivity } from "@/modules/maintenance/data/activity";
import { ceoUserIds, expenseLinks, loadExpenseTracking } from "@/modules/maintenance/data/expense-tracking";
import { expenseDueAt, trackingActive } from "@/modules/maintenance/lib/expense-deadline";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";

import { ceoTitle } from "@/lib/ceo-title";
/**
 * ขอเลื่อนกำหนดบันทึกค่าใช้จ่าย (ผู้ใช้ 3/11/2569) — แยกจากขอเลื่อนกำหนดส่งใบงาน (due-request-actions.ts)
 *   ขอได้:      คนในรายชื่อผู้บันทึกค่าใช้จ่าย · ใบต้องปิดแล้วและยังไม่บันทึก · ต้องใส่เหตุผล · ขอได้ทั้งก่อนและหลังครบกำหนด
 *   อนุมัติได้:  CEO (หรือผู้ดูแลสูงสุด) ที่ไม่ใช่คนขอเอง · ไม่อนุมัติต้องใส่เหตุผล
 *   หักคะแนนแล้วไม่คืน — อนุมัติหลังเลยกำหนดมีผลแค่วันใหม่ กติกาเดียวกับงานและใบงาน (อนุมัติหลังเลยกำหนด = โดนหัก)
 */
const PENDING_TITLE = "ขอเลื่อนบันทึกค่าใช้จ่าย รออนุมัติ";

const ymdBkk = (d: Date) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);

function refresh(id: string) {
  revalidatePath(`/maintenance/work-orders/${id}`);
  revalidatePath("/maintenance/work-orders");
}

async function log(orgId: string, userId: string, wo: { id: string; code: string; title: string }, summary: string, detail?: Record<string, unknown>) {
  await logActivity(orgId, {
    userId,
    entity: "work_order",
    entityId: wo.id,
    entityCode: wo.code,
    action: "update",
    summary: `${summary} ${wo.code} "${wo.title}"`,
    detail,
  });
}

/** ใบนี้ยังรอบันทึกอยู่ไหม */
async function stillPending(orgId: string, id: string) {
  const wo = await getWorkOrder(orgId, id);
  if (!wo || wo.status !== "completed" || !wo.requiresExpense || wo.isPrivate) return null;
  const has = await prisma.expense.count({ where: { orgId, workOrderId: id } });
  if (has > 0) return null;
  const link = (await expenseLinks(orgId, [id])).get(id);
  return link?.hold ? null : { ...wo, clockFrom: link?.clockFrom ?? null };
}

export async function requestExpenseExtensionAction(workOrderId: string, newDate: string, reason: string): Promise<{ error?: string }> {
  const s = await requireOrg();
  const t = await loadExpenseTracking(s.orgId);
  if (!trackingActive(t) || !t.recorderIds.includes(s.userId)) return { error: "ขอเลื่อนได้เฉพาะผู้บันทึกค่าใช้จ่าย" };
  const wo = await stillPending(s.orgId, workOrderId);
  if (!wo) return { error: "ใบนี้ไม่ได้รอบันทึกค่าใช้จ่ายแล้ว" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return { error: "วันที่ไม่ถูกต้อง" };
  const d = new Date(`${newDate}T23:59:59.999+07:00`);
  if (Number.isNaN(d.getTime())) return { error: "วันที่ไม่ถูกต้อง" };
  const due = expenseDueAt(wo, t);
  const today = ymdBkk(new Date());
  if (newDate <= ymdBkk(due) || newDate < today) return { error: "วันใหม่ต้องหลังกำหนดเดิมและไม่ก่อนวันนี้" };
  const why = reason.trim();
  if (!why) return { error: "ใส่เหตุผลที่ต้องเลื่อน" };

  const replaced = await prisma.workOrderDueRequest.findFirst({ where: { orgId: s.orgId, workOrderId, kind: "expense", status: "pending" } });
  if (replaced) {
    await prisma.workOrderDueRequest.update({
      where: { id: replaced.id },
      data: { status: "cancelled", decidedBy: s.userId, decidedAt: new Date(), decisionNote: "ขอใหม่แทน" },
    });
    await deleteActionNotifications(wo.id, "work_order", [PENDING_TITLE], replaced.createdAt);
  }
  await prisma.workOrderDueRequest.create({
    data: { orgId: s.orgId, workOrderId, kind: "expense", requestedBy: s.userId, previousDate: due, newDate: d, reason: why },
  });
  const range = `${fmtThaiDate(due)} → ${fmtThaiDate(d)}`;
  await addWorkOrderComment(s.orgId, workOrderId, s.userId, `ขอเลื่อนบันทึกค่าใช้จ่าย ${range} · ${why}`, null, { kind: "log" });
  await log(s.orgId, s.userId, wo, `ขอเลื่อนบันทึกค่าใช้จ่าย ${range} ของ`, { reason: why });

  const who = (await notifyActorName(s.userId)) ?? "ผู้บันทึกค่าใช้จ่าย";
  await notifyUsers(s.orgId, (await ceoUserIds(s.orgId)).filter((id) => id !== s.userId), {
    title: `${who} · ⏰ ${PENDING_TITLE}`,
    body: `${wo.code} ${wo.title} · ${range} · ${why}`,
    type: "work_order",
    referenceId: wo.id,
    line: `⏰ ${PENDING_TITLE}\n📝 ${wo.code} ${wo.title}\n📅 ${range}\n💬 ${why}\n👤 ${who}`,
  });
  refresh(workOrderId);
  return {};
}

export async function cancelExpenseExtensionAction(requestId: string): Promise<{ error?: string }> {
  const s = await requireOrg();
  const r = await prisma.workOrderDueRequest.findFirst({ where: { orgId: s.orgId, id: requestId, kind: "expense", status: "pending" } });
  if (!r) return { error: "ไม่พบคำขอที่รออนุมัติ" };
  if (r.requestedBy !== s.userId) return { error: "ยกเลิกได้เฉพาะคนขอ" };
  await prisma.workOrderDueRequest.update({ where: { id: r.id }, data: { status: "cancelled", decidedBy: s.userId, decidedAt: new Date() } });
  await deleteActionNotifications(r.workOrderId, "work_order", [PENDING_TITLE], r.createdAt);
  await addWorkOrderComment(s.orgId, r.workOrderId, s.userId, "ยกเลิกคำขอเลื่อนบันทึกค่าใช้จ่าย", null, { kind: "log" });
  refresh(r.workOrderId);
  return {};
}

export async function decideExpenseExtensionAction(requestId: string, approve: boolean, note: string): Promise<{ error?: string }> {
  const ceo = await ceoTitle();
  const s = await requireOrg();
  if (!hasRole(s, "CEO") && !isSuperAdmin(s)) return { error: `อนุมัติได้เฉพาะ ${ceo}` };
  const r = await prisma.workOrderDueRequest.findFirst({ where: { orgId: s.orgId, id: requestId, kind: "expense" } });
  if (!r || r.status !== "pending") return { error: "คำขอนี้ถูกตัดสินไปแล้ว" };
  if (r.requestedBy === s.userId) return { error: "อนุมัติคำขอของตัวเองไม่ได้" };
  const memo = note.trim() || null;
  if (!approve && !memo) return { error: "ใส่เหตุผลที่ไม่อนุมัติ" };
  const wo = await getWorkOrder(s.orgId, r.workOrderId);
  if (!wo) return { error: "ไม่พบใบงาน" };

  const done = await prisma.workOrderDueRequest.updateMany({
    where: { orgId: s.orgId, id: r.id, status: "pending" },
    data: { status: approve ? "approved" : "rejected", decidedBy: s.userId, decidedAt: new Date(), decisionNote: memo },
  });
  if (done.count === 0) return { error: "คำขอนี้ถูกตัดสินไปแล้ว" };
  await resolveActionNotifications(wo.id, "work_order", [PENDING_TITLE]);
  if (approve) await updateWorkOrder(s.orgId, wo.id, { expenseDueDate: r.newDate });

  const text = approve
    ? `อนุมัติเลื่อนบันทึกค่าใช้จ่ายเป็น ${fmtThaiDate(r.newDate)}${memo ? ` · ${memo}` : ""}`
    : `ไม่อนุมัติเลื่อนบันทึกค่าใช้จ่าย (ขอ ${fmtThaiDate(r.newDate)})${memo ? ` · ${memo}` : ""}`;
  await addWorkOrderComment(s.orgId, wo.id, s.userId, text, null, { kind: "log" });
  await log(s.orgId, s.userId, wo, `${text} ของ`);

  const who = (await notifyActorName(s.userId)) ?? ceo;
  await notifyUser(s.orgId, r.requestedBy, {
    title: approve ? `${who} · ✅ อนุมัติเลื่อนบันทึกค่าใช้จ่าย` : `${who} · ❌ ไม่อนุมัติเลื่อนบันทึกค่าใช้จ่าย`,
    body: `${wo.code} ${wo.title}${approve ? ` · ครบกำหนดใหม่ ${fmtThaiDate(r.newDate)}` : ""}${memo ? ` · ${memo}` : ""}`,
    type: "work_order",
    referenceId: wo.id,
    line: `${approve ? "✅ อนุมัติ" : "❌ ไม่อนุมัติ"}เลื่อนบันทึกค่าใช้จ่าย\n📝 ${wo.code} ${wo.title}${approve ? `\n📅 ครบกำหนดใหม่ ${fmtThaiDate(r.newDate)}` : ""}${memo ? `\n💬 ${memo}` : ""}`,
  });
  refresh(wo.id);
  return {};
}
