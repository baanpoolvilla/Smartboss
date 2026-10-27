import "server-only";
import { prisma } from "@smartboss/database";

import { broadcastToChannel, channelMemberIds, getChannelAccess } from "./channels";
import { notifyNewMessage } from "./notify";
import { ChatError, hydrateMessages, type ChatActor } from "./serialize";

/**
 * การ์ดงานลงห้อง (kind "task") — หลังสร้างงานจากแชท ("เปิดเป็นงาน" ที่ข้อความ / ปุ่ม + สร้างงาน)
 * ส่งได้เฉพาะงานที่ตัวเองเป็นคนสั่ง — กันคนยัด taskId ของงานอื่นมาโชว์ชื่องานในห้อง
 * งานยังไม่ขึ้นเซิร์ฟเวอร์ (บอร์ดบันทึกแบบหน่วง) = 404 ให้เครื่องลองใหม่
 * นับยังไม่อ่าน/แจ้งเตือนเหมือนการ์ดอัลบั้ม · คนส่งถือว่าอ่านแล้ว
 */
export async function postTaskCard(actor: ChatActor, channelId: string, taskId: string, sourceMessageId: string | null) {
  const access = await getChannelAccess(actor, channelId);
  const task = await prisma.reportTask.findFirst({
    where: { orgId: actor.orgId, id: taskId },
    select: { id: true, title: true, assignedById: true, assigneeIds: true },
  });
  if (!task) throw new ChatError("ยังไม่พบงานนี้", 404);
  if (task.assignedById !== actor.userId) throw new ChatError("ส่งการ์ดได้เฉพาะงานที่คุณสั่ง", 403);
  // งานส่วนตัว (สั่งให้ตัวเอง) ห้ามโผล่ในห้อง — ชื่องานห้ามหลุด (report_task/lib/personal-task.ts)
  if (task.assigneeIds.length === 1 && task.assigneeIds[0] === actor.userId) throw new ChatError("งานส่วนตัวไม่ส่งลงห้อง", 400);
  // ส่งซ้ำ (เน็ตแย่/กดซ้ำ) ได้การ์ดเดิม
  const existing = await prisma.chatMessage.findFirst({
    where: { orgId: actor.orgId, channelId, kind: "task", deletedAt: null, meta: { path: ["taskId"], equals: taskId } },
    select: { id: true },
  });
  if (existing) return { id: existing.id };
  const source = sourceMessageId
    ? await prisma.chatMessage.findFirst({ where: { orgId: actor.orgId, channelId, id: sourceMessageId }, select: { id: true } })
    : null;

  const meta = { taskId, sourceMessageId: source?.id ?? null };
  const card = await prisma.$transaction(async (tx) => {
    const card = await tx.chatMessage.create({
      data: { orgId: actor.orgId, channelId, authorId: actor.userId, kind: "task", body: `สร้างงาน "${task.title}"`, meta },
    });
    await tx.chatReadState.upsert({
      where: { channelId_userId: { channelId, userId: actor.userId } },
      update: { lastReadSeq: card.seq, lastReadAt: card.createdAt },
      create: { channelId, userId: actor.userId, orgId: actor.orgId, lastReadSeq: card.seq, lastReadAt: card.createdAt },
    });
    return card;
  });
  const memberIds = access.type === "org" ? [] : await channelMemberIds(actor.orgId, channelId);
  const [[message], author] = await Promise.all([
    hydrateMessages(actor.orgId, [card]),
    prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } }),
  ]);
  await broadcastToChannel(
    actor.orgId,
    channelId,
    { type: "chat.message", channelId, message: message!, authorName: author?.name, channelName: access.name, channelType: access.type },
    memberIds
  );
  void notifyNewMessage(actor, channelId, access.type, memberIds, message!);
  return { id: card.id };
}
