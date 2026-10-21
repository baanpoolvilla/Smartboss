import "server-only";
import { randomUUID } from "node:crypto";

import { prisma } from "@smartboss/database";
import { hasPermission, hasRole, isSuperAdmin, type OrgSession } from "@smartboss/auth";

import { eventDay, PERFORMANCE_CATEGORIES } from "@/lib/performance";
import { loadScorePeriodConfig } from "@/lib/score-period-config";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { notifyActorName, notifyUser, notifyUsers, resolveActionNotifications } from "@/modules/maintenance/data/notify";
import { addWorkOrderComment } from "@/modules/maintenance/data/work-orders";
import { listCeoUserIds, listPenaltyRequests } from "@/modules/report_task/lib/db/report-penalty-requests";
import { readTasks, writeTasks } from "@/modules/report_task/lib/db/task-repo";
import { penaltyRequestOpen, retroSubmitDeadline } from "@/modules/report_task/lib/penalty-request-window";
import type { Task } from "@/modules/report_task/types";
import {
  SCORE_REASON_TAGS,
  SCORE_REQ_DECIDED,
  SCORE_REQ_PENDING,
  SCORE_REQ_PENDING_TITLE,
  SCORE_REQUEST_CATEGORIES,
  listScoreRequests,
  updateScoreRequests,
  type ScoreRequest,
  type ScoreRequestCategory,
} from "@/lib/score-request-store";

/**
 * ยื่น / อนุมัติคำขอแก้คะแนน "ส่งงานเลยกำหนด · ใบงานเกินกำหนด · ไม่ทำ PM ตามรอบ" (ผู้ใช้ขอ 21/10/2569)
 *
 * กติกาที่ตกลงกับผู้ใช้:
 *   - คนอนุมัติหลัก = เจ้าของเรื่อง: คนสั่งงาน (Task.assignedById) / คนเปิดใบงาน / คนสร้างแผน PM
 *     ต้องเป็นบัญชีที่ยังใช้งาน และไม่ใช่คนที่โดนหักหรือคนยื่นเอง — ไม่งั้นไม่มีคนอนุมัติหลัก (null)
 *   - CEO อนุมัติแทนได้ทุกใบ แต่ได้แจ้งเตือนเฉพาะใบที่ไม่มีคนอนุมัติหลัก (หรือ CEO เป็นเจ้าของเรื่องเอง)
 *   - ยื่น/อนุมัติได้ถึง 23:59 วันตัดรอบของรอบที่โดนหัก — เลยแล้วไม่มีผล ไม่ยกไปเดือนหน้า
 *   - อนุมัติ = event ตรงข้าม `<refType>_undo` เท่าที่หักไปจริง ลงวันเดียวกับที่หัก (ไม่ลบของเดิม)
 *   - ระบบคืนคะแนนเอง (เลื่อนกำหนด/ยกเลิกใบงาน ฯลฯ) ⇒ ลบ undo ตามไปด้วย + ปิดคำขอที่ค้าง (กันคืนสองรอบ)
 */

const BASE_REF_TYPE: Record<ScoreRequestCategory, string> = {
  task_late: "task",
  workorder_overdue: "work_order",
  pm_missed: "pm_schedule",
};

const APPROVER_ROLE: Record<ScoreRequestCategory, string> = {
  task_late: "คนสั่งงาน",
  workorder_overdue: "คนเปิดใบงาน",
  pm_missed: "คนสร้างแผน PM",
};

export function isScoreRequestCategory(c: string): c is ScoreRequestCategory {
  return (SCORE_REQUEST_CATEGORIES as readonly string[]).includes(c);
}

function isTopApprover(session: OrgSession): boolean {
  return hasRole(session, "CEO") || isSuperAdmin(session);
}

/** ตัดสินคำขอนี้ได้ไหม — คนโดนหักตัดสินของตัวเองไม่ได้ (แม้เป็น CEO) */
export function canDecideScoreRequest(session: OrgSession, r: Pick<ScoreRequest, "userId" | "submittedBy" | "approverId">): boolean {
  if (r.userId === session.userId || r.submittedBy === session.userId) return false;
  return isTopApprover(session) || r.approverId === session.userId;
}

async function activeUserId(orgId: string, id: string | null | undefined, exclude: string[]): Promise<string | null> {
  if (!id || exclude.includes(id)) return null;
  const u = await prisma.user.findFirst({ where: { orgId, id, isActive: true }, select: { id: true } });
  return u?.id ?? null;
}

/** ต้นเรื่องของการหัก — ชื่อ/เลข + เจ้าของเรื่องที่อนุมัติได้ */
async function resolveTarget(
  orgId: string,
  category: ScoreRequestCategory,
  refId: string,
  exclude: string[]
): Promise<{ target: ScoreRequest["target"]; approverId: string | null; title: string | null }> {
  if (category === "task_late") {
    const taskId = refId.split(":")[0]!;
    const { tasks } = await readTasks(orgId);
    const t = tasks.find((x) => x.id === taskId);
    return {
      target: { kind: "task", id: taskId, code: t?.code ?? null },
      approverId: await activeUserId(orgId, t?.assignedById, exclude),
      title: t?.title ?? null,
    };
  }
  if (category === "workorder_overdue") {
    const wo = await prisma.workOrder.findFirst({ where: { orgId, id: refId }, select: { code: true, title: true, createdBy: true } });
    return {
      target: { kind: "work_order", id: refId, code: wo?.code ?? null },
      approverId: await activeUserId(orgId, wo?.createdBy, exclude),
      title: wo ? `${wo.code ? `${wo.code} · ` : ""}${wo.title}` : null,
    };
  }
  const pmId = refId.split(":")[0]!;
  const pm = await prisma.pmSchedule.findFirst({ where: { orgId, id: pmId }, select: { title: true, createdBy: true } });
  return {
    target: { kind: "pm", id: pmId, code: null },
    approverId: await activeUserId(orgId, pm?.createdBy, exclude),
    title: pm?.title ?? null,
  };
}

/** คนที่ต้องได้แจ้งเตือน "รออนุมัติ" — เจ้าของเรื่อง หรือ CEO ถ้าไม่มีเจ้าของเรื่องที่อนุมัติได้ */
async function pendingRecipients(orgId: string, r: ScoreRequest): Promise<string[]> {
  if (r.approverId) return [r.approverId];
  const ceos = await listCeoUserIds(orgId);
  return ceos.filter((id) => id !== r.userId && id !== r.submittedBy);
}

const fmtPts = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);
const thaiDay = (day: string) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short" }).format(new Date(`${day}T12:00:00+07:00`));

export function scoreRequestLabel(r: Pick<ScoreRequest, "category">): string {
  return PERFORMANCE_CATEGORIES[r.category] ?? r.category;
}

export async function createScoreRequest(
  session: OrgSession,
  input: { eventId: string; reasonTag: string; reason: string }
): Promise<{ error: string } | { error: null; request: ScoreRequest }> {
  const orgId = session.orgId;
  const reason = input.reason.trim();
  if (!(SCORE_REASON_TAGS as readonly string[]).includes(input.reasonTag)) return { error: "เลือกเหตุผลก่อน" };
  if (reason.length < 3) return { error: "พิมพ์รายละเอียดเพิ่มอีกนิด" };
  if (reason.length > 500) return { error: "รายละเอียดยาวเกินไป (ไม่เกิน 500 ตัวอักษร)" };

  const ev = await prisma.performanceEvent.findFirst({
    where: { orgId, id: input.eventId },
    select: { id: true, userId: true, source: true, category: true, refType: true, refId: true, points: true, occurredAt: true, note: true },
  });
  if (!ev || !isScoreRequestCategory(ev.category) || !ev.refId || ev.refType !== BASE_REF_TYPE[ev.category] || Number(ev.points) >= 0) {
    return { error: "ไม่พบรายการหักคะแนนนี้" };
  }
  // ยื่นของตัวเองได้เสมอ — ยื่นแทนคนอื่นต้องเห็นผลงานรายคนได้ (เหมือนคำร้องรายงาน)
  if (ev.userId !== session.userId && !hasPermission(session, ADMIN_PERMS.performanceView)) return { error: "ไม่มีสิทธิ์" };

  const day = eventDay(ev.occurredAt);
  if (!penaltyRequestOpen(day, await loadScorePeriodConfig(orgId))) {
    return { error: "ปิดรอบแล้ว — ขอแก้คะแนนได้ถึง 23:59 ของวันตัดรอบเท่านั้น" };
  }
  const undone = await prisma.performanceEvent.findFirst({
    where: { orgId, source: ev.source, category: ev.category, refType: `${ev.refType}_undo`, refId: ev.refId },
    select: { id: true },
  });
  if (undone) return { error: "รายการนี้คืนคะแนนไปแล้ว" };

  const category = ev.category;
  const { target, approverId, title } = await resolveTarget(orgId, category, ev.refId, [ev.userId, session.userId]);
  const request: ScoreRequest = {
    id: randomUUID(),
    userId: ev.userId,
    submittedBy: session.userId,
    category,
    eventId: ev.id,
    source: ev.source,
    refType: ev.refType!,
    refId: ev.refId,
    points: Number(ev.points),
    day,
    title: title ?? ev.note ?? scoreRequestLabel({ category }),
    target,
    approverId,
    approverRole: APPROVER_ROLE[category],
    reasonTag: input.reasonTag,
    reason,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  const saved = await updateScoreRequests(orgId, session.userId, (list) => {
    if (list.some((r) => r.status === "pending" && r.category === category && r.refId === ev.refId)) return null;
    return { next: [request, ...list], result: request };
  });
  if (!saved) return { error: "มีคำขอของรายการนี้รอพิจารณาอยู่แล้ว" };

  const who = (await notifyActorName(session.userId)) ?? "พนักงาน";
  const recipients = await pendingRecipients(orgId, request);
  await notifyUsers(orgId, recipients, {
    title: `${who} · 🛡️ ${SCORE_REQ_PENDING_TITLE}: ${request.title}`,
    body: `${scoreRequestLabel(request)} ${fmtPts(request.points)} · ${request.reasonTag} — ${reason}`,
    type: SCORE_REQ_PENDING,
    referenceId: request.id,
    line: `🛡️ ขอแก้คะแนน (รออนุมัติ)\n📝 ${request.title}\n${scoreRequestLabel(request)} ${fmtPts(request.points)}\n💬 ${request.reasonTag} — ${reason}\n👤 ${who}`,
  });
  if (target.kind === "work_order") {
    await addWorkOrderComment(
      orgId,
      target.id,
      session.userId,
      `🛡️ ขอแก้คะแนน ${fmtPts(request.points)} (โดนหัก ${thaiDay(day)}) · ${request.reasonTag} — ${reason}`,
      null,
      { kind: "log" }
    ).catch((err) => console.error("[score-requests] wo log", err));
  }
  return { error: null, request };
}

/** งานในบอร์ด: ทำเครื่องหมายยกเว้นที่ penalty (การ์ดขึ้น "คืนคะแนนแล้ว") + บันทึกในคอมเมนต์ของงาน */
async function markTaskWaived(orgId: string, r: ScoreRequest, decidedBy: string, note: string) {
  const [taskId, assigneeId] = r.refId.split(":") as [string, string | undefined];
  const waived = { byUserId: decidedBy, at: new Date().toISOString(), reason: `${r.reasonTag} — ${r.reason}` };
  for (let attempt = 0; attempt < 4; attempt++) {
    const { tasks, version } = await readTasks(orgId);
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const next: Task = {
      ...t,
      ...(assigneeId
        ? t.penalties?.[assigneeId]
          ? { penalties: { ...t.penalties, [assigneeId]: { ...t.penalties[assigneeId]!, waived } } }
          : {}
        : t.penalty
          ? { penalty: { ...t.penalty, waived } }
          : {}),
      comments: [
        ...t.comments,
        {
          id: `${taskId}-cmt-${randomUUID()}`,
          authorId: decidedBy,
          message: `[อนุมัติคำขอแก้คะแนน] คืน ${Math.abs(r.points)} คะแนน · ${r.reasonTag} — ${r.reason}${note ? ` · ${note}` : ""}`,
          createdAt: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    // userId null = งานของระบบ — ไม่ผ่านการกรองสิทธิ์ยกเว้นของ client (คืนคะแนนออกเองข้างล่างแล้ว)
    const saved = await writeTasks(orgId, tasks.map((x) => (x.id === taskId ? next : x)), version, null);
    if (saved.ok) return;
  }
  console.error("[score-requests] mark task waived: version conflict", r.id);
}

export async function decideScoreRequest(
  session: OrgSession,
  input: { id: string; decision: "approved" | "rejected"; note?: string }
): Promise<{ error: string } | { error: null; request: ScoreRequest }> {
  const orgId = session.orgId;
  const note = (input.note ?? "").trim().slice(0, 300);
  const period = await loadScorePeriodConfig(orgId);

  // ตรวจต้นเรื่องก่อนจองสถานะ — ระบบคืนไปแล้ว/event หาย ⇒ ปิดคำขอแทนการอนุมัติซ้ำ
  const current = (await listScoreRequests(orgId)).find((r) => r.id === input.id);
  if (!current) return { error: "ไม่พบคำขอนี้" };
  if (current.status !== "pending") return { error: "คำขอนี้มีคนตัดสินไปแล้ว — โหลดหน้าใหม่" };
  if (!canDecideScoreRequest(session, current)) return { error: "คุณไม่มีสิทธิ์ตัดสินคำขอนี้" };
  if (input.decision === "rejected" && note.length < 2) return { error: "ใส่เหตุผลที่ไม่อนุมัติ" };

  const original = await prisma.performanceEvent.findFirst({
    where: { orgId, id: current.eventId },
    select: { userId: true, points: true, occurredAt: true, refId: true },
  });
  const alreadyUndone = await prisma.performanceEvent.findFirst({
    where: { orgId, source: current.source, category: current.category, refType: `${current.refType}_undo`, refId: current.refId },
    select: { id: true },
  });
  const goneReason = !original ? "ระบบคืนคะแนนให้แล้ว (ไม่มีการหักครั้งนี้แล้ว)" : alreadyUndone ? "คืนคะแนนไปแล้ว" : null;
  if (input.decision === "approved") {
    if (goneReason) {
      await updateScoreRequests(orgId, session.userId, (list) => {
        const i = list.findIndex((r) => r.id === input.id && r.status === "pending");
        if (i < 0) return null;
        const next = [...list];
        next[i] = { ...list[i]!, status: "closed", decidedAt: new Date().toISOString(), closedReason: goneReason };
        return { next, result: true };
      });
      await resolveActionNotifications(input.id, SCORE_REQ_PENDING, [SCORE_REQ_PENDING_TITLE]);
      return { error: `${goneReason} — ปิดคำขอให้แล้ว` };
    }
    if (!penaltyRequestOpen(current.day, period)) {
      return { error: "ปิดรอบแล้ว (23:59 ของวันตัดรอบ) — อนุมัติตอนนี้ไม่มีผลกับคะแนน กด \"ไม่อนุมัติ\" เพื่อปิดคำขอ" };
    }
  }

  // จองสถานะก่อน (คนแรกที่กดชนะ) แล้วค่อยคืนคะแนน — สองคนกดพร้อมกันไม่คืนสองรอบ
  const decided = await updateScoreRequests(orgId, session.userId, (list) => {
    const i = list.findIndex((r) => r.id === input.id);
    if (i < 0 || list[i]!.status !== "pending") return null;
    const updated: ScoreRequest = {
      ...list[i]!,
      status: input.decision,
      decidedAt: new Date().toISOString(),
      decidedBy: session.userId,
      ...(note ? { decisionNote: note } : {}),
    };
    const next = [...list];
    next[i] = updated;
    return { next, result: updated };
  });
  if (!decided) return { error: "คำขอนี้มีคนตัดสินไปแล้ว — โหลดหน้าใหม่" };

  if (decided.status === "approved" && original) {
    await prisma.performanceEvent.createMany({
      data: [
        {
          orgId,
          userId: original.userId,
          source: decided.source,
          category: decided.category,
          points: -Number(original.points),
          occurredAt: original.occurredAt,
          refType: `${decided.refType}_undo`,
          refId: decided.refId,
          note: `อนุมัติคำขอแก้คะแนน: ${decided.reasonTag} — ${decided.reason}`,
          createdBy: session.userId,
        },
      ],
      skipDuplicates: true,
    });
    if (decided.target.kind === "task") await markTaskWaived(orgId, decided, session.userId, note);
  }

  const who = (await notifyActorName(session.userId)) ?? "ผู้อนุมัติ";
  if (decided.target.kind === "work_order") {
    const text =
      decided.status === "approved"
        ? `✅ อนุมัติคำขอแก้คะแนน · คืน +${Math.abs(decided.points)} ให้ ${(await notifyActorName(decided.userId)) ?? "ผู้รับผิดชอบ"}${note ? ` · "${note}"` : ""}`
        : `❌ ไม่อนุมัติคำขอแก้คะแนน${note ? ` · "${note}"` : ""}`;
    await addWorkOrderComment(orgId, decided.target.id, session.userId, text, null, { kind: "log" }).catch((err) =>
      console.error("[score-requests] wo log", err)
    );
  }

  // จัดการแล้ว ⇒ "รออนุมัติ" หายจากทุกคน (เจ้าของเรื่อง + CEO) · แจ้งผลคนที่โดนหัก (+ คนยื่นแทน)
  await resolveActionNotifications(decided.id, SCORE_REQ_PENDING, [SCORE_REQ_PENDING_TITLE]);
  const approved = decided.status === "approved";
  await notifyUsers(
    orgId,
    [decided.userId, decided.submittedBy].filter((id) => id !== session.userId),
    {
      title: approved
        ? `✅ คืนคะแนน +${Math.abs(decided.points)} แล้ว: ${decided.title}`
        : `❌ ไม่อนุมัติคำขอแก้คะแนน: ${decided.title}`,
      body: `${scoreRequestLabel(decided)} · โดย ${who}${note ? ` · ${note}` : ""}`,
      type: SCORE_REQ_DECIDED,
      referenceId: decided.id,
      line: approved
        ? `✅ คำขอแก้คะแนนได้รับอนุมัติ — คืน +${Math.abs(decided.points)}\n📝 ${decided.title}\n👤 ${who}`
        : `❌ คำขอแก้คะแนนไม่ได้รับอนุมัติ\n📝 ${decided.title}${note ? `\n💬 ${note}` : ""}\n👤 ${who}`,
    }
  );
  return { error: null, request: decided };
}

/**
 * เตือนวันตัดรอบ (เรียกจาก cron รายชั่วโมง) — เช้า 08:59 และบ่าย 14:59 ของวันตัดรอบ
 * แต่ละคนได้เฉพาะใบที่ตัวเองต้องตัดสิน: เจ้าของเรื่อง · CEO ได้ใบที่ไม่มีเจ้าของเรื่อง
 * + คำร้องรายงานที่ CEO อนุมัติคนเดียว (report-penalty-requests)
 */
export async function remindPendingScoreRequests(orgId: string, pending: ScoreRequest[], reportPending: number): Promise<number> {
  const byUser = new Map<string, number>();
  const ceos = await listCeoUserIds(orgId);
  for (const r of pending) {
    const to = r.approverId ? [r.approverId] : ceos.filter((id) => id !== r.userId && id !== r.submittedBy);
    for (const id of to) byUser.set(id, (byUser.get(id) ?? 0) + 1);
  }
  for (const id of ceos) if (reportPending > 0) byUser.set(id, (byUser.get(id) ?? 0) + reportPending);
  for (const [userId, n] of byUser) {
    await notifyUser(orgId, userId, {
      title: `⏰ วันนี้วันตัดรอบ · คำขอแก้คะแนนรอคุณ ${n} ใบ`,
      body: "ต้องตัดสินภายใน 23:59 วันนี้ — หลังจากนั้นอนุมัติไปก็ไม่มีผลกับคะแนนรอบนี้",
      type: SCORE_REQ_PENDING,
      referenceId: null,
    });
  }
  return byUser.size;
}

/**
 * งานวันตัดรอบสำหรับ cron รายชั่วโมง — รันจริงเฉพาะ 08:59 และ 14:59 ของวันตัดรอบ (เวลาไทย) · `force` = รันเลย
 * นับเฉพาะคำขอที่ยังอนุมัติทัน (รอบยังไม่ปิด) — งานลงเวลา/ลา ไม่รวม (HR มีแจ้งเตือนของตัวเองอยู่แล้ว)
 */
export async function runCutoffReminders(opts: { force?: boolean; now?: Date } = {}): Promise<{ orgs: number; notified: number; skipped?: string }> {
  const now = opts.now ?? new Date();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (!opts.force && hour !== 8 && hour !== 14) return { orgs: 0, notified: 0, skipped: "not reminder hour" };
  const orgs = await prisma.organization.findMany({ where: { isActive: true }, select: { id: true } });
  let notified = 0;
  let touched = 0;
  for (const { id: orgId } of orgs) {
    const period = await loadScorePeriodConfig(orgId);
    // วันนี้ต้องเป็นวันตัดรอบของรอบที่กำลังนับ: ปิดภายใน 24 ชม.ข้างหน้า
    const dueToday = (day: string) => {
      if (!penaltyRequestOpen(day, period, now)) return false;
      return retroSubmitDeadline(day, period).getTime() - now.getTime() <= 24 * 3600_000;
    };
    const pending = (await listScoreRequests(orgId)).filter((r) => r.status === "pending" && dueToday(r.day));
    const reportPending = (await listPenaltyRequests(orgId)).filter((r) => r.status === "pending" && dueToday(r.day)).length;
    if (pending.length === 0 && reportPending === 0) continue;
    touched += 1;
    notified += await remindPendingScoreRequests(orgId, pending, reportPending);
  }
  return { orgs: touched, notified };
}
