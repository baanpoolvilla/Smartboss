import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@smartboss/database";

import { APPROVE_CHANNEL_NAME, APPROVE_CHANNEL_PREFIX, type ChatApprovalInfo, type ChatTaskCard } from "../types";
import { broadcastToChannel } from "./channels";
import { hydrateMessages } from "./serialize";
import { taskTags, workOrderTags } from "./task-cards";

/**
 * ห้อง "คำขออนุมัติ" ส่วนตัวของแต่ละคน (ผู้ใช้ 18/11/2569 "เป็นแชทระบบเหมือนพวกลงเวลา กดอนุมัติได้เลย")
 * spec: docs/superpowers/specs/2026-11-18-due-request-approval-chat-design.md
 *
 *  - ห้อง id คงที่ approve-<userId> (แบบห้องระบบลงเวลา clock-<userId>) — ขึ้นเมื่อมีคำขอแรก
 *  - การ์ด = ข้อความ kind "task" + meta.approval ⇒ นับยังไม่อ่าน ไม่เด้ง ไม่ส่งมือถือ (กระดิ่งเดิมยังแจ้งอยู่)
 *  - ผู้เขียน = คนขอ (เห็นรูป/ชื่อคนขอ) · ส่งถึงคนเดียวกับที่ได้กระดิ่งเรื่องนั้น (คนเรียกเป็นคนเลือก)
 *  - สถานะบนการ์ดอ่านสดจากคำขอจริงตอนโหลดข้อความ (liveApprovalStatuses) — กดที่บอร์ด/หน้าใบงานการ์ดก็เปลี่ยนตาม
 *  - ไม่ throw — การ์ดพลาดต้องไม่ทำให้การขอเลื่อนพลาด
 */

export function approveChannelId(userId: string): string {
  return `${APPROVE_CHANNEL_PREFIX}${userId}`;
}

const ensured = globalThis as unknown as { __approveChannels?: Set<string> };
const ensuredChannels = (ensured.__approveChannels ??= new Set<string>());

async function ensureApprovalChannel(orgId: string, userId: string): Promise<string> {
  const id = approveChannelId(userId);
  if (!ensuredChannels.has(id)) {
    await prisma.chatChannel.upsert({
      where: { id },
      update: { archived: false },
      create: { id, orgId, type: "group", name: APPROVE_CHANNEL_NAME, createdById: userId },
    });
    ensuredChannels.add(id);
  }
  // กดออกจากห้องไปแล้ว คำขอถัดไปก็กลับเข้าห้องเอง (แบบห้องระบบลงเวลา)
  await prisma.chatChannelMember.createMany({ data: [{ channelId: id, userId, orgId, role: "member" }], skipDuplicates: true });
  return id;
}

async function postCard(orgId: string, approverId: string, input: { authorId: string; body: string; card: ChatTaskCard }): Promise<void> {
  try {
    const channelId = await ensureApprovalChannel(orgId, approverId);
    const row = await prisma.chatMessage.create({
      data: {
        orgId,
        channelId,
        authorId: input.authorId,
        kind: "task",
        body: input.body,
        meta: input.card as unknown as Prisma.InputJsonValue,
        clientId: `appr-${input.card.approval!.source}-${input.card.approval!.requestId}`,
      },
    });
    const [[message], author] = await Promise.all([
      hydrateMessages(orgId, [row]),
      prisma.user.findUnique({ where: { id: input.authorId }, select: { name: true } }),
    ]);
    await broadcastToChannel(orgId, channelId, { type: "chat.message", channelId, message: message!, authorName: author?.name, channelType: "group" }, [approverId]);
  } catch (err) {
    // คำขอเดิมโพสต์ไปแล้ว (clientId ซ้ำ) — ปกติ
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    console.error("[chat] approval card failed", err);
  }
}

async function namesOf(orgId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.user.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } }).catch(() => []);
  return new Map(rows.map((r) => [r.id, r.name]));
}

const ymd = (d: Date | null) => (d ? new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10) : null);

/**
 * ขอเลื่อนงานบนบอร์ด — เรียกจากแจ้งเตือน task_due_request (org-store) ที่ส่งถึงคนอนุมัติ
 * คำขอบันทึกจากฝั่งเครื่อง อาจยังไม่ลงตาราง: อ่านซ้ำได้ ~6 วิ · ไม่เจอคำขอที่รออยู่ = ไม่โพสต์
 */
export async function postTaskDueRequestCard(orgId: string, input: { taskId: string; requesterId: string; approverId: string }): Promise<void> {
  if (input.requesterId === input.approverId) return;
  try {
    const read = () =>
      prisma.reportTask
        .findUnique({
          where: { orgId_id: { orgId, id: input.taskId } },
          select: { title: true, code: true, parentId: true, data: true, assigneeIds: true },
        })
        .catch(() => null);
    type Req = { id: string; requestedBy: string; requestedAt?: string; newDate: string; previousDate: string; reason: string; status: string; forUserIds?: string[] };
    const pendingOf = (data: unknown): Req | undefined => {
      const list = data && typeof data === "object" ? (data as { dueDateRequests?: unknown }).dueDateRequests : null;
      if (!Array.isArray(list)) return undefined;
      return (list as Req[])
        .filter((r) => r && r.status === "pending" && r.requestedBy === input.requesterId && typeof r.id === "string")
        .sort((a, b) => (b.requestedAt ?? "").localeCompare(a.requestedAt ?? ""))[0];
    };
    let task = await read();
    let req = pendingOf(task?.data);
    for (let i = 0; i < 15 && !req; i++) {
      await new Promise((r) => setTimeout(r, 400));
      task = await read();
      req = pendingOf(task?.data);
    }
    if (!task || !req) return;
    const forIds = (req.forUserIds ?? []).filter((id) => typeof id === "string");
    const names = await namesOf(orgId, [input.requesterId, ...forIds]);
    const isGroup = (task.data as { taskMode?: unknown } | null)?.taskMode === "group";
    const approval: ChatApprovalInfo = {
      source: "task",
      requestId: req.id,
      requesterId: input.requesterId,
      ...(names.get(input.requesterId) ? { requesterName: names.get(input.requesterId) } : {}),
      previousDate: req.previousDate || null,
      newDate: req.newDate,
      reason: String(req.reason ?? "").slice(0, 500),
      ...(isGroup && forIds.length > 1 ? { forNames: forIds.map((id) => names.get(id) ?? "?"), memberCount: task.assigneeIds.length } : {}),
      status: "pending",
    };
    await postCard(orgId, input.approverId, {
      authorId: input.requesterId,
      body: `ขอเลื่อนกำหนดส่งงาน "${task.title.slice(0, 120)}"`,
      card: {
        taskId: input.taskId,
        title: task.title.slice(0, 200),
        dueDate: req.previousDate || null,
        link: `/report-task/tasks?task=${encodeURIComponent(input.taskId)}`,
        ...(task.code ? { code: task.code } : {}),
        tags: taskTags(task),
        approval,
      },
    });
  } catch (err) {
    console.error("[chat] task approval card failed", err);
  }
}

/** ขอเลื่อนส่งใบแจ้งซ่อม / ขอเลื่อนบันทึกค่าใช้จ่าย — เรียกหลังสร้างคำขอ ส่งถึงคนเดียวกับที่ได้กระดิ่ง "รออนุมัติ" */
export async function postWorkOrderDueRequestCards(orgId: string, input: { requestId: string; approverIds: string[] }): Promise<void> {
  try {
    const r = await prisma.workOrderDueRequest.findFirst({ where: { orgId, id: input.requestId } });
    if (!r) return;
    const wo = await prisma.workOrder.findFirst({
      where: { orgId, id: r.workOrderId },
      select: { id: true, title: true, code: true, groupMemberIds: true, pmScheduleId: true, pmScheduleIds: true, autoCreated: true, createdBy: true },
    });
    if (!wo) return;
    const source: ChatApprovalInfo["source"] = r.kind === "expense" ? "expense" : "work_order";
    const names = await namesOf(orgId, [r.requestedBy, ...r.forUserIds]);
    const approval: ChatApprovalInfo = {
      source,
      requestId: r.id,
      requesterId: r.requestedBy,
      ...(names.get(r.requestedBy) ? { requesterName: names.get(r.requestedBy) } : {}),
      previousDate: ymd(r.previousDate),
      newDate: ymd(r.newDate)!,
      reason: r.reason.slice(0, 500),
      ...(r.forUserIds.length > 1 ? { forNames: r.forUserIds.map((id) => names.get(id) ?? "?"), memberCount: wo.groupMemberIds.length } : {}),
      status: "pending",
    };
    const card: ChatTaskCard = {
      taskId: wo.id,
      title: wo.title.slice(0, 200),
      dueDate: ymd(r.previousDate),
      link: `/maintenance/work-orders/${wo.id}`,
      target: "work_order",
      ...(wo.code ? { code: wo.code } : {}),
      tags: workOrderTags(wo),
      approval,
    };
    const body = source === "expense" ? `ขอเลื่อนบันทึกค่าใช้จ่าย "${wo.title.slice(0, 120)}"` : `ขอเลื่อนกำหนดส่งใบแจ้งซ่อม "${wo.title.slice(0, 120)}"`;
    for (const approverId of new Set(input.approverIds)) {
      if (approverId === r.requestedBy) continue;
      await postCard(orgId, approverId, { authorId: r.requestedBy, body, card });
    }
  } catch (err) {
    console.error("[chat] work order approval card failed", err);
  }
}
