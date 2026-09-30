import "server-only";
import { prisma } from "@smartboss/database";
import { rateLimit } from "@smartboss/auth/ratelimit";

import { announceNotification } from "@/lib/notify-push";
import { notifyUsers } from "@/modules/maintenance/data/notify";
import type { ChatAttachment, ChatMessageDTO, ChatNoteCommentDTO, ChatNoteDTO } from "../types";
import { deleteOrphanFiles } from "./albums";
import { broadcastToChannel, channelMemberIds, getChannelAccess } from "./channels";
import { validateAttachments } from "./messages";
import { notifyNewMessage } from "./notify";
import { ChatError, hydrateMessages, noteExcerpt, notePreview, type ChatActor } from "./serialize";
import { CHAT_PAGE_PATH } from "../constants";

/**
 * โน้ตของห้องแชท (แบบ LINE) — ข้อความยาว + รูป เก็บถาวร มีคอมเมนต์และถูกใจ
 *
 * สร้างโน้ต = โพสต์ "การ์ดโน้ต" (chat.messages kind "note") ลงห้องด้วย ⇒ ยังไม่อ่าน, เด้งแจ้งเตือน,
 * รายการห้อง ใช้ทางเดียวกับข้อความปกติทั้งหมด (notifyNewMessage) · ลบโน้ต = การ์ดกลายเป็น "ยกเลิกข้อความ"
 *
 * ใครอยู่ในห้องก็อ่าน/สร้าง/คอมเมนต์/ถูกใจได้ · แก้/ลบโน้ต = คนเขียน หรือแอดมินห้อง
 * · ลบคอมเมนต์ = คนคอมเมนต์ คนเขียนโน้ต หรือแอดมินห้อง
 * รูปในโน้ตไม่หมดอายุ (งานเก็บกวาดไฟล์แชทไล่เฉพาะไฟล์ที่แนบในข้อความ)
 */

const MAX_NOTE_LENGTH = 10_000;
const MAX_COMMENT_LENGTH = 2_000;
const MAX_NOTE_IMAGES = 20;
const NOTE_LIMIT = { count: 10, windowSeconds: 60 };

type NoteRow = {
  id: string;
  channelId: string;
  authorId: string;
  body: string;
  attachments: unknown;
  createdAt: Date;
  updatedAt: Date;
};

async function noteWithAccess(actor: ChatActor, noteId: string) {
  const note = await prisma.chatNote.findFirst({ where: { id: noteId, orgId: actor.orgId } });
  if (!note) throw new ChatError("ไม่พบโน้ตนี้ อาจถูกลบไปแล้ว", 404);
  const access = await getChannelAccess(actor, note.channelId);
  return { note, access, canEdit: note.authorId === actor.userId || access.canManage };
}

function cleanBody(body: unknown, max: number, empty: string): string {
  const clean = typeof body === "string" ? body.trim().slice(0, max) : "";
  if (!clean) throw new ChatError(empty, 400);
  return clean;
}

async function cleanImages(orgId: string, input: unknown): Promise<ChatAttachment[]> {
  const list = Array.isArray(input) ? input.slice(0, MAX_NOTE_IMAGES) : [];
  const attachments = await validateAttachments(orgId, list);
  if (attachments.some((a) => a.kind !== "image")) throw new ChatError("แนบในโน้ตได้เฉพาะรูปภาพ", 400);
  return attachments;
}

function toDTO(note: NoteRow, actor: ChatActor, canEdit: boolean, likeUserIds: string[], commentCount: number): ChatNoteDTO {
  return {
    id: note.id,
    channelId: note.channelId,
    authorId: note.authorId,
    body: note.body,
    attachments: (note.attachments as ChatAttachment[] | null) ?? [],
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    // updatedAt ขยับตอนสร้างการ์ด (ใส่ messageId) ด้วย — นับว่าแก้เมื่อห่างกันเกินนาที
    edited: note.updatedAt.getTime() - note.createdAt.getTime() > 60_000,
    likeUserIds,
    commentCount,
    canEdit,
  };
}

/** โน้ตทั้งหมดของห้อง ใหม่ → เก่า */
export async function listNotes(actor: ChatActor, channelId: string): Promise<ChatNoteDTO[]> {
  const access = await getChannelAccess(actor, channelId);
  const notes = await prisma.chatNote.findMany({
    where: { orgId: actor.orgId, channelId },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { likes: { select: { userId: true } }, _count: { select: { comments: true } } },
  });
  return notes.map((n) =>
    toDTO(n, actor, n.authorId === actor.userId || access.canManage, n.likes.map((l) => l.userId), n._count.comments)
  );
}

export async function getNote(actor: ChatActor, noteId: string): Promise<{ note: ChatNoteDTO; comments: ChatNoteCommentDTO[] }> {
  const { note, access, canEdit } = await noteWithAccess(actor, noteId);
  const [likes, comments] = await Promise.all([
    prisma.chatNoteLike.findMany({ where: { orgId: actor.orgId, noteId }, orderBy: { createdAt: "asc" }, select: { userId: true } }),
    prisma.chatNoteComment.findMany({ where: { orgId: actor.orgId, noteId }, orderBy: { createdAt: "asc" }, take: 500 }),
  ]);
  return {
    note: toDTO(note, actor, canEdit, likes.map((l) => l.userId), comments.length),
    comments: comments.map((c) => ({
      id: c.id,
      authorId: c.authorId,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      canDelete: c.authorId === actor.userId || note.authorId === actor.userId || access.canManage,
    })),
  };
}

/** สร้างโน้ต + โพสต์การ์ดลงห้อง + แจ้งเตือนสมาชิก */
export async function createNote(
  actor: ChatActor,
  channelId: string,
  input: { body?: unknown; attachments?: unknown }
): Promise<{ id: string; message: ChatMessageDTO }> {
  const access = await getChannelAccess(actor, channelId);
  const limited = await rateLimit(`chat:note:${actor.userId}`, NOTE_LIMIT.count, NOTE_LIMIT.windowSeconds);
  if (!limited.allowed) throw new ChatError("สร้างโน้ตเร็วเกินไป รอสักครู่แล้วลองใหม่", 429);

  const body = cleanBody(input.body, MAX_NOTE_LENGTH, "เขียนเนื้อหาโน้ตก่อน");
  const attachments = await cleanImages(actor.orgId, input.attachments);

  const { note, card } = await prisma.$transaction(async (tx) => {
    const note = await tx.chatNote.create({
      data: { orgId: actor.orgId, channelId, authorId: actor.userId, body, attachments: attachments as unknown as object },
    });
    const card = await tx.chatMessage.create({
      data: { orgId: actor.orgId, channelId, authorId: actor.userId, kind: "note", body: noteExcerpt(body) },
    });
    await tx.chatNote.update({ where: { id: note.id }, data: { messageId: card.id } });
    // คนสร้างถือว่าอ่านถึงการ์ดของตัวเองแล้ว
    await tx.chatReadState.upsert({
      where: { channelId_userId: { channelId, userId: actor.userId } },
      update: { lastReadSeq: card.seq, lastReadAt: card.createdAt },
      create: { channelId, userId: actor.userId, orgId: actor.orgId, lastReadSeq: card.seq, lastReadAt: card.createdAt },
    });
    return { note, card };
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
  void notifyNewMessage(actor, channelId, access.type, memberIds, message as ChatMessageDTO);
  // การ์ดกลับไปให้เครื่องคนสร้างใส่ห้องเองทันที — ไม่พึ่งท่อสดอย่างเดียว (ท่อสดหลุดชั่วคราว = การ์ดไม่ขึ้นจนรีเฟรช)
  return { id: note.id, message: message as ChatMessageDTO };
}

export async function updateNote(actor: ChatActor, noteId: string, input: { body?: unknown; attachments?: unknown }): Promise<void> {
  const { note, canEdit } = await noteWithAccess(actor, noteId);
  if (!canEdit) throw new ChatError("แก้ได้เฉพาะคนเขียนโน้ตหรือแอดมินห้อง", 403);
  const body = cleanBody(input.body, MAX_NOTE_LENGTH, "เขียนเนื้อหาโน้ตก่อน");
  const attachments = await cleanImages(actor.orgId, input.attachments);

  const updated = await prisma.chatNote.update({
    where: { id: noteId },
    data: { body, attachments: attachments as unknown as object },
  });
  if (note.messageId) {
    await prisma.chatMessage.updateMany({ where: { orgId: actor.orgId, id: note.messageId }, data: { body: noteExcerpt(body) } });
  }
  // รูปที่เอาออกจากโน้ต — ไม่มีใครใช้แล้วก็ลบไฟล์ทิ้ง
  const kept = new Set(attachments.flatMap((a) => [a.url, a.thumbUrl]));
  const removed = ((note.attachments as ChatAttachment[] | null) ?? []).flatMap((a) => [a.url, ...(a.thumbUrl ? [a.thumbUrl] : [])]).filter((u) => !kept.has(u));
  await deleteOrphanFiles(actor.orgId, removed);

  await broadcastToChannel(actor.orgId, note.channelId, { type: "chat.note", channelId: note.channelId, noteId, preview: notePreview(updated) });
}

export async function deleteNote(actor: ChatActor, noteId: string): Promise<void> {
  const { note, canEdit } = await noteWithAccess(actor, noteId);
  if (!canEdit) throw new ChatError("ลบได้เฉพาะคนเขียนโน้ตหรือแอดมินห้อง", 403);
  await prisma.chatNote.delete({ where: { id: noteId } });
  if (note.messageId) {
    await prisma.chatMessage.updateMany({ where: { orgId: actor.orgId, id: note.messageId }, data: { deletedAt: new Date() } });
    await broadcastToChannel(actor.orgId, note.channelId, { type: "chat.message.deleted", channelId: note.channelId, messageId: note.messageId });
  }
  await broadcastToChannel(actor.orgId, note.channelId, { type: "chat.note", channelId: note.channelId, noteId });
  const files = ((note.attachments as ChatAttachment[] | null) ?? []).flatMap((a) => [a.url, ...(a.thumbUrl ? [a.thumbUrl] : [])]);
  await deleteOrphanFiles(actor.orgId, files);
}

/**
 * คอมเมนต์ — แจ้งคนเขียนโน้ต + คนที่เคยคอมเมนต์ในโน้ตนี้ (แบบ LINE) ลงกระดิ่ง + เด้ง
 * แม้ปิดเสียงห้องไว้ (เป็นเรื่องที่เราเข้าไปมีส่วนร่วมแล้ว)
 */
export async function addComment(actor: ChatActor, noteId: string, bodyInput: unknown): Promise<ChatNoteCommentDTO> {
  const { note } = await noteWithAccess(actor, noteId);
  const limited = await rateLimit(`chat:send:${actor.userId}`, 40, 20);
  if (!limited.allowed) throw new ChatError("ส่งเร็วเกินไป รอสักครู่แล้วลองใหม่", 429);
  const body = cleanBody(bodyInput, MAX_COMMENT_LENGTH, "พิมพ์คอมเมนต์ก่อน");
  const comment = await prisma.chatNoteComment.create({ data: { orgId: actor.orgId, noteId, authorId: actor.userId, body } });
  await broadcastToChannel(actor.orgId, note.channelId, { type: "chat.note", channelId: note.channelId, noteId });

  void (async () => {
    try {
      const earlier = await prisma.chatNoteComment.findMany({ where: { orgId: actor.orgId, noteId }, select: { authorId: true }, distinct: ["authorId"] });
      const to = [note.authorId, ...earlier.map((c) => c.authorId)].filter((id) => id !== actor.userId);
      if (to.length === 0) return;
      const author = await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
      const title = `${author?.name ?? "เพื่อนร่วมงาน"} คอมเมนต์โน้ต "${noteExcerpt(note.body).slice(0, 40)}"`;
      await notifyUsers(actor.orgId, to, {
        title,
        body: body.slice(0, 140),
        type: "chat_note_comment",
        referenceId: `${note.channelId}|${noteId}`,
      });
      // notifyUser ไม่เด้งให้แจ้งเตือนชนิด chat_* (แชทเด้งเองทางข้อความ) — คอมเมนต์ไม่ใช่ข้อความในห้อง ต้องเด้งเอง
      await announceNotification(actor.orgId, [...new Set(to)], {
        title,
        body: body.slice(0, 140),
        url: `${CHAT_PAGE_PATH}?c=${encodeURIComponent(note.channelId)}&note=${encodeURIComponent(noteId)}`,
        tag: `note-${noteId}`,
      });
    } catch (err) {
      console.error("[chat] note comment notify failed", err);
    }
  })();

  return { id: comment.id, authorId: comment.authorId, body: comment.body, createdAt: comment.createdAt.toISOString(), canDelete: true };
}

export async function deleteComment(actor: ChatActor, noteId: string, commentId: string): Promise<void> {
  const { note, access } = await noteWithAccess(actor, noteId);
  const comment = await prisma.chatNoteComment.findFirst({ where: { id: commentId, noteId, orgId: actor.orgId } });
  if (!comment) return;
  if (comment.authorId !== actor.userId && note.authorId !== actor.userId && !access.canManage) {
    throw new ChatError("ลบได้เฉพาะคอมเมนต์ของตัวเอง", 403);
  }
  await prisma.chatNoteComment.delete({ where: { id: comment.id } });
  await broadcastToChannel(actor.orgId, note.channelId, { type: "chat.note", channelId: note.channelId, noteId });
}

/** กด/เลิกกดถูกใจ — คืนรายชื่อคนที่ถูกใจหลังกด */
export async function toggleLike(actor: ChatActor, noteId: string): Promise<{ likeUserIds: string[] }> {
  const { note } = await noteWithAccess(actor, noteId);
  const key = { noteId_userId: { noteId, userId: actor.userId } };
  const existing = await prisma.chatNoteLike.findUnique({ where: key });
  if (existing) await prisma.chatNoteLike.delete({ where: key });
  else await prisma.chatNoteLike.create({ data: { orgId: actor.orgId, noteId, userId: actor.userId } }).catch(() => undefined);
  const likes = await prisma.chatNoteLike.findMany({ where: { orgId: actor.orgId, noteId }, orderBy: { createdAt: "asc" }, select: { userId: true } });
  await broadcastToChannel(actor.orgId, note.channelId, { type: "chat.note", channelId: note.channelId, noteId });
  return { likeUserIds: likes.map((l) => l.userId) };
}
