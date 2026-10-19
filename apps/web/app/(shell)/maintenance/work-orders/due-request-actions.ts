"use server";

import { revalidatePath } from "next/cache";
import { canViewAll, requireOrg } from "@smartboss/auth";
import { getWorkOrder, updateWorkOrder, addWorkOrderComment } from "@/modules/maintenance/data/work-orders";
import { workOrderAccess, canSeeWorkOrder } from "@/modules/maintenance/data/work-order-access";
import { notifyActorName, notifyUser, notifyUsers, resolveActionNotifications, usersWithPermission } from "@/modules/maintenance/data/notify";
import { createDueRequest, decideDueRequest, getDueRequest, listDueRequests } from "@/modules/maintenance/data/work-order-due-requests";
import { logActivity } from "@/modules/maintenance/data/activity";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import { canDecideDueRequest, canEditDueDate } from "@/modules/maintenance/lib/due-request-access";
import { isPastDay } from "@/modules/maintenance/lib/no-past-date";

/**
 * ขอเลื่อนกำหนดส่งใบงาน — แบบเดียวกับงานบนบอร์ดงาน (ผู้ใช้ขอ 17/10/2569)
 *   ขอได้:     ผู้รับผิดชอบใบงาน · ใบงานยังไม่เสร็จ/ไม่ยกเลิก · มีกำหนดส่ง · ขอได้แค่ "เลื่อนออกไป"
 *   อนุมัติได้: CEO (สิทธิ์ดูข้อมูลทั้งบริษัท) หรือคนเปิดใบงาน — ที่ไม่ใช่คนขอเอง
 *   อนุมัติ = แก้กำหนดส่งของใบงานทันที + บันทึกในความคิดเห็น (log) + แจ้งคนขอ
 */

/** YYYY-MM-DD → สิ้นวันเวลาไทย — เหมือน parseDueDate ใน actions.ts (cron เทียบ < ตรง ๆ) */
function endOfDayBkk(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T23:59:59.999+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
const ymdBkk = (d: Date) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);

/** หัวข้อแจ้งเตือนคำขอ (ใช้หาแถวที่ต้องเคลียร์เมื่อคำขอจบ) — ต้องตรงกับ title ใน requestDueDateAction */
const PENDING_TITLE = "ขอเลื่อนกำหนดส่งใบงาน รออนุมัติ";

type Session = Awaited<ReturnType<typeof requireOrg>>;
type Wo = NonNullable<Awaited<ReturnType<typeof getWorkOrder>>>;

function log(s: Session, wo: Wo, summary: string, detail?: Record<string, unknown>) {
  return logActivity(s.orgId, {
    userId: s.userId,
    entity: "work_order",
    entityId: wo.id,
    entityCode: wo.code,
    action: "update",
    summary: `${summary} ${wo.code ?? ""} "${wo.title}"`.replace(/\s+/g, " ").trim(),
    detail,
  });
}

function refresh(id: string) {
  revalidatePath(`/maintenance/work-orders/${id}`);
  revalidatePath("/maintenance/work-orders");
}

export async function requestDueDateAction(workOrderId: string, newDate: string, reason: string): Promise<{ error?: string }> {
  const s = await requireOrg();
  const wo = await getWorkOrder(s.orgId, workOrderId);
  if (!wo || !canSeeWorkOrder(await workOrderAccess(s), wo)) return { error: "ไม่พบใบงาน" };
  if (wo.assignedTo !== s.userId) return { error: "ขอเลื่อนได้เฉพาะผู้รับผิดชอบใบงาน" };
  if (wo.status === "completed" || wo.status === "cancelled") return { error: "ใบงานนี้ปิดแล้ว" };
  if (!wo.dueDate) return { error: "ใบงานนี้ไม่มีกำหนดส่ง" };
  const d = endOfDayBkk(newDate);
  if (!d) return { error: "วันที่ไม่ถูกต้อง" };
  if (ymdBkk(d) <= ymdBkk(wo.dueDate)) return { error: "วันใหม่ต้องหลังกำหนดส่งเดิม" };
  const why = reason.trim();
  if (!why) return { error: "ใส่เหตุผลที่ต้องเลื่อน" };

  await createDueRequest(s.orgId, { workOrderId, requestedBy: s.userId, previousDate: wo.dueDate, newDate: d, reason: why });
  await addWorkOrderComment(s.orgId, workOrderId, s.userId, `ขอเลื่อนกำหนดส่ง ${fmtThaiDate(wo.dueDate)} → ${fmtThaiDate(d)} · ${why}`, null, { kind: "log" });
  await log(s, wo, `ขอเลื่อนกำหนดส่ง ${fmtThaiDate(wo.dueDate)} → ${fmtThaiDate(d)} ของ`, { reason: why });

  // แจ้งคนที่อนุมัติได้: CEO + คนเปิดใบงาน (ไม่รวมคนขอ)
  const approvers = new Set<string>([
    ...(await usersWithPermission(s.orgId, "core.data.view_all")),
    ...(wo.createdBy ? [wo.createdBy] : []),
  ]);
  approvers.delete(s.userId);
  const who = (await notifyActorName(s.userId)) ?? "ผู้รับผิดชอบ";
  await notifyUsers(s.orgId, [...approvers], {
    title: `${who} · ⏰ ขอเลื่อนกำหนดส่งใบงาน รออนุมัติ`,
    body: `${wo.title} · ${fmtThaiDate(wo.dueDate)} → ${fmtThaiDate(d)} · ${why}`,
    type: "work_order",
    referenceId: wo.id,
    line: `⏰ ขอเลื่อนกำหนดส่งใบงาน (รออนุมัติ)\n📝 ${wo.title}\n📅 ${fmtThaiDate(wo.dueDate)} → ${fmtThaiDate(d)}\n💬 ${why}\n👤 ${who}`,
  });
  refresh(workOrderId);
  return {};
}

export async function cancelDueRequestAction(requestId: string): Promise<{ error?: string }> {
  const s = await requireOrg();
  const r = await getDueRequest(s.orgId, requestId);
  if (!r || r.status !== "pending") return { error: "ไม่พบคำขอที่รออนุมัติ" };
  if (r.requestedBy !== s.userId) return { error: "ยกเลิกได้เฉพาะคนขอ" };
  const wo = await getWorkOrder(s.orgId, r.workOrderId);
  if (!wo) return { error: "ไม่พบใบงาน" };
  await decideDueRequest(s.orgId, requestId, { status: "cancelled", decidedBy: s.userId });
  // คำขอจบแล้ว ⇒ แจ้งเตือน "รออนุมัติ" ของผู้อนุมัติทุกคนเคลียร์ (ไม่ใช่แค่ของคนที่กด)
  await resolveActionNotifications(wo.id, "work_order", [PENDING_TITLE]);
  await addWorkOrderComment(s.orgId, wo.id, s.userId, "ยกเลิกคำขอเลื่อนกำหนดส่ง", null, { kind: "log" });
  await log(s, wo, "ยกเลิกคำขอเลื่อนกำหนดส่งของ");
  refresh(wo.id);
  return {};
}

export async function decideDueRequestAction(requestId: string, approve: boolean, note: string): Promise<{ error?: string }> {
  const s = await requireOrg();
  const r = await getDueRequest(s.orgId, requestId);
  if (!r || r.status !== "pending") return { error: "คำขอนี้ถูกตัดสินไปแล้ว" };
  const wo = await getWorkOrder(s.orgId, r.workOrderId);
  if (!wo || !canSeeWorkOrder(await workOrderAccess(s), wo)) return { error: "ไม่พบใบงาน" };
  if (!canDecideDueRequest({ userId: s.userId, viewAll: canViewAll(s) }, wo, r.requestedBy)) return { error: "ไม่มีสิทธิ์อนุมัติคำขอนี้" };
  const memo = note.trim() || null;

  const ok = await decideDueRequest(s.orgId, requestId, { status: approve ? "approved" : "rejected", decidedBy: s.userId, decisionNote: memo });
  if (!ok) return { error: "คำขอนี้ถูกตัดสินไปแล้ว" };
  // คนหนึ่งอนุมัติ/ไม่อนุมัติแล้ว ⇒ "รออนุมัติ" ที่ผู้อนุมัติคนอื่นจะไม่ขึ้นแล้ว (ผู้ใช้ขอ 18/10/2569)
  await resolveActionNotifications(wo.id, "work_order", [PENDING_TITLE]);
  if (approve) await updateWorkOrder(s.orgId, wo.id, { dueDate: r.newDate });

  const text = approve
    ? `อนุมัติเลื่อนกำหนดส่ง ${fmtThaiDate(wo.dueDate)} → ${fmtThaiDate(r.newDate)}${memo ? ` · ${memo}` : ""}`
    : `ไม่อนุมัติเลื่อนกำหนดส่ง (ขอ ${fmtThaiDate(r.newDate)})${memo ? ` · ${memo}` : ""}`;
  await addWorkOrderComment(s.orgId, wo.id, s.userId, text, null, { kind: "log" });
  await log(s, wo, `${text} ของ`);

  const who = (await notifyActorName(s.userId)) ?? "ผู้อนุมัติ";
  await notifyUser(s.orgId, r.requestedBy, {
    title: approve ? `${who} · ✅ อนุมัติเลื่อนกำหนดส่งใบงาน` : `${who} · ❌ ไม่อนุมัติเลื่อนกำหนดส่งใบงาน`,
    body: `${wo.title} · ${approve ? `กำหนดส่งใหม่ ${fmtThaiDate(r.newDate)}` : `ยังเป็น ${fmtThaiDate(wo.dueDate)}`}${memo ? ` · ${memo}` : ""}`,
    type: "work_order",
    referenceId: wo.id,
    line: `${approve ? "✅ อนุมัติ" : "❌ ไม่อนุมัติ"}เลื่อนกำหนดส่งใบงาน\n📝 ${wo.title}\n📅 ${approve ? `กำหนดส่งใหม่ ${fmtThaiDate(r.newDate)}` : `ยังเป็น ${fmtThaiDate(wo.dueDate)}`}${memo ? `\n💬 ${memo}` : ""}`,
  });
  refresh(wo.id);
  return {};
}

/**
 * แก้กำหนดส่งตรง ๆ — CEO / คนเปิดใบงาน (ผู้ใช้ขอ 19/10/2569) ไม่ต้องขออนุมัติ
 *   เลื่อนออกหรือเลื่อนเข้าได้ แต่ไม่ก่อนวันนี้ (เวลาไทย) · ใบงานต้องยังไม่ปิด
 *   มีคำขอเลื่อนค้างอยู่ ⇒ ปิดคำขอนั้นไปด้วย (กำหนดส่งถูกตั้งใหม่แล้ว)
 *   บันทึกในความคิดเห็น (log) + แจ้งผู้รับผิดชอบ
 */
export async function editDueDateAction(workOrderId: string, newDate: string, reason: string): Promise<{ error?: string }> {
  const s = await requireOrg();
  const wo = await getWorkOrder(s.orgId, workOrderId);
  if (!wo || !canSeeWorkOrder(await workOrderAccess(s), wo)) return { error: "ไม่พบใบงาน" };
  if (!canEditDueDate({ userId: s.userId, viewAll: canViewAll(s) }, wo)) return { error: "แก้กำหนดส่งได้เฉพาะ CEO หรือคนเปิดใบงาน" };
  if (wo.status === "completed" || wo.status === "cancelled") return { error: "ใบงานนี้ปิดแล้ว" };
  const d = endOfDayBkk(newDate);
  if (!d) return { error: "วันที่ไม่ถูกต้อง" };
  if (isPastDay(newDate)) return { error: "กำหนดส่งต้องไม่ก่อนวันนี้" };
  if (wo.dueDate && ymdBkk(d) === ymdBkk(wo.dueDate)) return {};
  const why = reason.trim();

  await updateWorkOrder(s.orgId, wo.id, { dueDate: d });
  const pending = (await listDueRequests(s.orgId, wo.id)).filter((r) => r.status === "pending");
  for (const r of pending) {
    await decideDueRequest(s.orgId, r.id, { status: "cancelled", decidedBy: s.userId, decisionNote: "แก้กำหนดส่งโดยตรงแล้ว" });
  }
  if (pending.length > 0) await resolveActionNotifications(wo.id, "work_order", [PENDING_TITLE]);

  const range = `${wo.dueDate ? fmtThaiDate(wo.dueDate) : "-"} → ${fmtThaiDate(d)}`;
  const text = `แก้กำหนดส่ง ${range}${why ? ` · ${why}` : ""}`;
  await addWorkOrderComment(s.orgId, wo.id, s.userId, text, null, { kind: "log" });
  await log(s, wo, `แก้กำหนดส่ง ${range} ของ`, why ? { reason: why } : undefined);

  if (wo.assignedTo && wo.assignedTo !== s.userId) {
    const who = (await notifyActorName(s.userId)) ?? "ผู้เปิดใบงาน";
    await notifyUser(s.orgId, wo.assignedTo, {
      title: `${who} · 📅 แก้กำหนดส่งใบงาน`,
      body: `${wo.title} · ${range}${why ? ` · ${why}` : ""}`,
      type: "work_order",
      referenceId: wo.id,
      line: `📅 แก้กำหนดส่งใบงาน\n📝 ${wo.title}\n📅 ${range}${why ? `\n💬 ${why}` : ""}\n👤 ${who}`,
    });
  }
  refresh(wo.id);
  return {};
}
