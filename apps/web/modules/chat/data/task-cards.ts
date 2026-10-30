import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@smartboss/database";

import type { ChatTaskCard } from "../types";
import { broadcastToChannel, getOrCreateDm } from "./channels";
import { hydrateMessages } from "./serialize";

/**
 * การ์ด "งานใหม่" ลงแชทส่วนตัว คนมอบหมาย ↔ ผู้รับผิดชอบ (ผู้ใช้ 30/10/2569)
 * "เปิดสร้างงานจากที่ไหนก็ได้ … ให้เจ้าตัวรู้ · กดการ์ดในแชทแล้วไปหน้า task ที่เป็นรายละเอียด"
 *
 * เรียกจาก org-store (announceNewNotifications) ตอนมีแจ้งเตือน "มอบหมายงาน" ใหม่ — ทุกทางที่สร้าง/มอบหมายงาน
 * (บอร์ด, แชท, โปรเจกต์, เพิ่มผู้รับผิดชอบทีหลัง) วิ่งผ่านแจ้งเตือนนี้ที่เดียว
 *
 *  - ไม่เด้งแจ้งเตือนซ้ำ (แจ้งเตือนมอบหมายงานเด้งไปแล้ว) — นับเป็นยังไม่อ่านในแชทอย่างเดียว
 *  - กันซ้ำด้วย clientId = task-<taskId> ต่อห้องต่อคนมอบหมาย (มอบหมายงานเดิมซ้ำไม่โพสต์ใหม่)
 *  - ไม่ throw — การ์ดพลาดต้องไม่ทำให้การบันทึกงานพลาด
 */
export async function postTaskCard(
  orgId: string,
  input: { assignerId: string; assigneeId: string; taskId: string; title: string; link: string }
): Promise<void> {
  if (input.assignerId === input.assigneeId) return;
  try {
    // แจ้งเตือนกับตัวงานบันทึกคนละจังหวะ — งานใหม่อาจยังไม่ลงตาราง รอแป๊บแล้วอ่านอีกรอบ (ไม่เจอก็โพสต์โดยไม่มีวันส่ง)
    const readTask = () =>
      prisma.reportTask.findUnique({ where: { orgId_id: { orgId, id: input.taskId } }, select: { title: true, dueDate: true } }).catch(() => null);
    let task = await readTask();
    if (!task) {
      await new Promise((r) => setTimeout(r, 2500));
      task = await readTask();
    }
    const card: ChatTaskCard = {
      taskId: input.taskId,
      title: task?.title ?? input.title,
      dueDate: task?.dueDate || null,
      link: input.link,
    };
    const channelId = await getOrCreateDm(orgId, input.assignerId, input.assigneeId);
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          orgId,
          channelId,
          authorId: input.assignerId,
          kind: "task",
          body: `มอบหมายงาน "${card.title}"`,
          meta: card as unknown as Prisma.InputJsonValue,
          clientId: `task-${input.taskId}`,
        },
      });
      // คนมอบหมายเห็นแล้วในตัว (ไม่ขึ้นยังไม่อ่านฝั่งตัวเอง)
      await tx.chatReadState.upsert({
        where: { channelId_userId: { channelId, userId: input.assignerId } },
        update: { lastReadSeq: created.seq, lastReadAt: created.createdAt },
        create: { channelId, userId: input.assignerId, orgId, lastReadSeq: created.seq, lastReadAt: created.createdAt },
      });
      return created;
    });
    const [[message], author] = await Promise.all([
      hydrateMessages(orgId, [row]),
      prisma.user.findUnique({ where: { id: input.assignerId }, select: { name: true } }),
    ]);
    await broadcastToChannel(
      orgId,
      channelId,
      { type: "chat.message", channelId, message: message!, authorName: author?.name, channelType: "dm" },
      [input.assignerId, input.assigneeId]
    );
  } catch (err) {
    // มอบหมายงานเดิมให้คนเดิมซ้ำ = การ์ดเดิมยังอยู่ในห้อง ไม่ต้องโพสต์ใหม่
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    console.error("[chat] task card failed", err);
  }
}
