import "server-only";
import { prisma } from "@smartboss/database";

import { assertChannelMember, orgChannelId } from "./channels";
import type { ChatAttachment, ChatMessageDTO } from "../types";

export type { ChatAttachment, ChatMessageDTO };

function toDTO(row: {
  id: string;
  seq: bigint;
  channelId: string;
  authorId: string;
  body: string | null;
  attachments: unknown;
  createdAt: Date;
}): ChatMessageDTO {
  return {
    id: row.id,
    seq: row.seq.toString(),
    channelId: row.channelId,
    authorId: row.authorId,
    body: row.body,
    attachments: (row.attachments as ChatAttachment[] | null) ?? [],
    createdAt: row.createdAt.toISOString(),
  };
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * โหลดข้อความ — ไม่มี `after` = หน้าแรก (ล่าสุด N ข้อความ, เรียงเก่า→ใหม่ให้ client
 * render ตรง ๆ) มี `after` = โพลหาข้อความใหม่กว่านั้น (เรียงเก่า→ใหม่เหมือนกัน)
 * `after` คือ ChatMessage.seq (ไม่ใช่ id) — seq เดียวเทียบ `>` ได้ตรง ๆ ไม่ต้อง
 * query ย้อนหา createdAt ของ cursor ก่อนแบบเดิม
 */
export async function listMessages(
  orgId: string,
  channelId: string,
  userId: string,
  opts: { after?: string; limit?: number } = {}
): Promise<ChatMessageDTO[]> {
  await assertChannelMember(orgId, channelId, userId);
  const limit = Math.min(opts.limit ?? DEFAULT_PAGE_SIZE, 100);

  if (opts.after) {
    let afterSeq: bigint;
    try {
      afterSeq = BigInt(opts.after);
    } catch {
      const err = new Error("คำขอไม่ถูกต้อง (after)");
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
    const rows = await prisma.chatMessage.findMany({
      where: { channelId, deletedAt: null, seq: { gt: afterSeq } },
      orderBy: { seq: "asc" },
      take: limit,
    });
    return rows.map(toDTO);
  }

  const rows = await prisma.chatMessage.findMany({
    where: { channelId, deletedAt: null },
    orderBy: { seq: "desc" },
    take: limit,
  });
  return rows.reverse().map(toDTO);
}

export async function createMessage(
  orgId: string,
  channelId: string,
  authorId: string,
  input: { body?: string; attachments?: ChatAttachment[] }
): Promise<ChatMessageDTO> {
  await assertChannelMember(orgId, channelId, authorId);

  const body = input.body?.trim() || null;
  const attachments = input.attachments ?? [];
  if (!body && attachments.length === 0) {
    const err = new Error("พิมพ์ข้อความหรือแนบไฟล์อย่างน้อยหนึ่งอย่าง");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }

  const row = await prisma.chatMessage.create({
    data: { orgId, channelId, authorId, body, attachments: attachments as unknown as object },
  });
  // ผู้ส่งเองถือว่าอ่านห้องนี้ถึงข้อความที่เพิ่งส่งแล้วเสมอ — กันข้อความตัวเองไปโผล่
  // เป็น "ยังไม่อ่าน" ของตัวเองตอน poll รอบถัดไป (ChatReadState ไม่ใช่
  // ChatChannelMember อีกต่อไป — ห้อง org ไม่มีแถว membership เลย)
  await prisma.chatReadState.upsert({
    where: { channelId_userId: { channelId, userId: authorId } },
    update: { lastReadSeq: row.seq, lastReadAt: row.createdAt },
    create: { channelId, userId: authorId, orgId, lastReadSeq: row.seq, lastReadAt: row.createdAt },
  });

  return toDTO(row);
}

/** userId ของสมาชิกห้องคนอื่น (ไม่รวมผู้ส่ง) — ใช้ยิงแจ้งเตือน ห้อง org ไม่มีแถว
 * ChatChannelMember เลย (ทุกคนเข้าได้โดยปริยาย) จึงต้องนับจาก core.users แทน */
export async function otherMemberIds(orgId: string, channelId: string, excludeUserId: string): Promise<string[]> {
  if (channelId === orgChannelId(orgId)) {
    const rows = await prisma.user.findMany({
      where: { orgId, isActive: true, id: { not: excludeUserId } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
  const rows = await prisma.chatChannelMember.findMany({
    where: { channelId, userId: { not: excludeUserId } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

const RECENTLY_DELETED_WINDOW_MS = 5 * 60 * 1000;

/**
 * id ของข้อความที่เพิ่งถูกลบไปหมาด ๆ (5 นาทีล่าสุด) ในห้องนี้ — ส่งกลับคู่กับ
 * ทุกครั้งที่โพล เพื่อให้จอของคนอื่นที่เห็นข้อความนั้นค้างอยู่แล้ว (โหลดไปก่อนโดนลบ)
 * เอาออกตามไปด้วย ไม่ต้องรอ reload หน้าถึงจะหาย — ลบจริงคือ soft-delete
 * (deletedAt) ไม่ใช่ตัดออกจากตาราง จึง query ย้อนกลับมาแบบนี้ได้
 */
export async function listRecentlyDeletedIds(channelId: string): Promise<string[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { channelId, deletedAt: { gt: new Date(Date.now() - RECENTLY_DELETED_WINDOW_MS) } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** ลบข้อความของตัวเอง (ส่งผิด) — soft delete เท่านั้น, ลบได้เฉพาะข้อความที่ตัวเองส่ง */
export async function deleteMessage(orgId: string, channelId: string, messageId: string, userId: string): Promise<void> {
  await assertChannelMember(orgId, channelId, userId);

  const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!message || message.channelId !== channelId || message.deletedAt) {
    const err = new Error("ไม่พบข้อความนี้");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
  if (message.authorId !== userId) {
    const err = new Error("ลบได้เฉพาะข้อความที่ตัวเองส่ง");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }

  await prisma.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
}
