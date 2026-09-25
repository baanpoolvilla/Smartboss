import "server-only";
import { prisma } from "@smartboss/database";
import { rateLimit } from "@smartboss/auth/ratelimit";

import { CHAT_REACTION_EMOJIS, type ChatAttachment, type ChatMessageDTO, type ChatReactionDTO } from "../types";
import { broadcastToChannel, channelMemberIds, getChannelAccess, orgChannelId } from "./channels";
import { ChatError, hydrateMessages, reactionsFor, type ChatActor } from "./serialize";

export type { ChatAttachment, ChatMessageDTO };

const DEFAULT_PAGE_SIZE = 50;
const MAX_BODY_LENGTH = 5000;
const MAX_ATTACHMENTS = 20;
/** กันสแปม/สคริปต์ยิงรัว — ต่อคน ไม่กระทบคนอื่นในบริษัทหรือบริษัทอื่น */
const SEND_LIMIT = { count: 40, windowSeconds: 20 };

function parseSeq(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new ChatError(`คำขอไม่ถูกต้อง (${name})`, 400);
  }
}

/**
 * โหลดข้อความของห้อง (เรียงเก่า → ใหม่ให้ client วาดตรง ๆ)
 *  - ไม่มี cursor = ล่าสุด N ข้อความ
 *  - before=<seq> = เลื่อนขึ้นดูข้อความเก่ากว่านั้น
 *  - after=<seq>  = ดึงส่วนที่พลาดไปตอนเน็ตหลุด/ต่อท่อสดใหม่
 * รวมข้อความที่ยกเลิกแล้ว (เป็นร่องรอย "ยกเลิกข้อความ") เพื่อให้ลำดับบนจอตรงกับทุกเครื่อง
 */
export async function listMessages(
  actor: ChatActor,
  channelId: string,
  opts: { after?: string; before?: string; limit?: number } = {}
): Promise<{ messages: ChatMessageDTO[]; hasMore: boolean }> {
  await getChannelAccess(actor, channelId);
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
  const base = { orgId: actor.orgId, channelId };

  if (opts.after) {
    const rows = await prisma.chatMessage.findMany({
      where: { ...base, seq: { gt: parseSeq(opts.after, "after") } },
      orderBy: { seq: "asc" },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    return { messages: await hydrateMessages(actor.orgId, rows.slice(0, limit)), hasMore };
  }

  const rows = await prisma.chatMessage.findMany({
    where: { ...base, ...(opts.before ? { seq: { lt: parseSeq(opts.before, "before") } } : {}) },
    orderBy: { seq: "desc" },
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  return { messages: await hydrateMessages(actor.orgId, rows.slice(0, limit).reverse()), hasMore };
}

/** ไฟล์แนบต้องเป็นไฟล์ที่อัปขึ้นแชทของบริษัทนี้จริง (มีแถวใน chat.files) — กันแนบ URL
 * มั่ว ๆ หรือไฟล์ของบริษัทอื่น ข้อมูลขนาด/ชนิดเชื่อจากฐานข้อมูล ไม่เชื่อ client */
async function validateAttachments(orgId: string, input: unknown): Promise<ChatAttachment[]> {
  if (!Array.isArray(input) || input.length === 0) return [];
  if (input.length > MAX_ATTACHMENTS) throw new ChatError(`แนบได้ครั้งละไม่เกิน ${MAX_ATTACHMENTS} ไฟล์`, 400);
  const items = input.filter((a): a is ChatAttachment => typeof a?.url === "string");
  const urls = items.flatMap((a) => [a.url, ...(typeof a.thumbUrl === "string" ? [a.thumbUrl] : [])]);
  const files = await prisma.chatFile.findMany({ where: { orgId, url: { in: urls } }, select: { url: true, size: true, mime: true, kind: true } });
  const byUrl = new Map(files.map((f) => [f.url, f]));

  return items.map((a) => {
    const file = byUrl.get(a.url);
    if (!file) throw new ChatError("ไฟล์แนบไม่ถูกต้อง ลองอัปโหลดใหม่", 400);
    const thumb = typeof a.thumbUrl === "string" && byUrl.has(a.thumbUrl) ? a.thumbUrl : undefined;
    const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v) : undefined);
    return {
      url: file.url,
      name: typeof a.name === "string" ? a.name.slice(0, 200) : "ไฟล์",
      mime: file.mime,
      size: file.size,
      kind: file.kind as ChatAttachment["kind"],
      ...(thumb ? { thumbUrl: thumb } : {}),
      ...(num(a.width, 20000) ? { width: num(a.width, 20000) } : {}),
      ...(num(a.height, 20000) ? { height: num(a.height, 20000) } : {}),
      ...(num(a.durationMs, 60 * 60 * 1000) ? { durationMs: num(a.durationMs, 60 * 60 * 1000) } : {}),
    };
  });
}

export interface CreateMessageInput {
  body?: string;
  attachments?: unknown;
  replyToId?: string;
  mentions?: string[];
  clientId?: string;
}

/**
 * บันทึกข้อความใหม่ แล้วส่งสดถึงทุกคนในห้อง
 * clientId ซ้ำ (เครื่องส่งซ้ำเพราะเน็ตหลุดระหว่างรอคำตอบ) → คืนข้อความเดิม ไม่สร้างใหม่
 */
export async function createMessage(
  actor: ChatActor,
  channelId: string,
  input: CreateMessageInput
): Promise<{ message: ChatMessageDTO; created: boolean; channelType: string; memberIds: string[] }> {
  const access = await getChannelAccess(actor, channelId);
  const clientId = typeof input.clientId === "string" ? input.clientId.slice(0, 64) : null;

  if (clientId) {
    const existing = await prisma.chatMessage.findUnique({
      where: { channelId_authorId_clientId: { channelId, authorId: actor.userId, clientId } },
    });
    if (existing) {
      const [message] = await hydrateMessages(actor.orgId, [existing]);
      return { message: message!, created: false, channelType: access.type, memberIds: [] };
    }
  }

  const limited = await rateLimit(`chat:send:${actor.userId}`, SEND_LIMIT.count, SEND_LIMIT.windowSeconds);
  if (!limited.allowed) throw new ChatError("ส่งข้อความเร็วเกินไป รอสักครู่แล้วลองใหม่", 429);

  const body = input.body?.trim().slice(0, MAX_BODY_LENGTH) || null;
  const attachments = await validateAttachments(actor.orgId, input.attachments);
  if (!body && attachments.length === 0) throw new ChatError("พิมพ์ข้อความหรือแนบไฟล์อย่างน้อยหนึ่งอย่าง", 400);

  let replyToId: string | null = null;
  if (typeof input.replyToId === "string" && input.replyToId) {
    const target = await prisma.chatMessage.findFirst({
      where: { id: input.replyToId, orgId: actor.orgId, channelId },
      select: { id: true },
    });
    replyToId = target?.id ?? null;
  }

  const memberIds = access.type === "org" ? [] : await channelMemberIds(actor.orgId, channelId);
  // แท็กได้เฉพาะคนในห้อง (ห้อง org = ทุกคนในบริษัท ตรวจกับ core.users)
  let mentions: string[] = [];
  if (Array.isArray(input.mentions) && body) {
    const wanted = Array.from(new Set(input.mentions.filter((m): m is string => typeof m === "string"))).slice(0, 50);
    const all = wanted.includes("all") && access.type !== "dm";
    const userIds = wanted.filter((m) => m !== "all" && m !== actor.userId);
    const valid =
      access.type === "org"
        ? (await prisma.user.findMany({ where: { orgId: actor.orgId, isActive: true, id: { in: userIds } }, select: { id: true } })).map((u) => u.id)
        : userIds.filter((id) => memberIds.includes(id));
    mentions = [...(all ? ["all"] : []), ...valid];
  }

  let row;
  try {
    row = await prisma.chatMessage.create({
      data: {
        orgId: actor.orgId,
        channelId,
        authorId: actor.userId,
        body,
        attachments: attachments as unknown as object,
        replyToId,
        mentions,
        clientId,
      },
    });
  } catch (err) {
    // สองคำขอ clientId เดียวกันมาพร้อมกัน — อีกอันบันทึกไปแล้ว ใช้อันนั้น
    if (clientId && (err as { code?: string }).code === "P2002") {
      const existing = await prisma.chatMessage.findUnique({
        where: { channelId_authorId_clientId: { channelId, authorId: actor.userId, clientId } },
      });
      if (existing) {
        const [message] = await hydrateMessages(actor.orgId, [existing]);
        return { message: message!, created: false, channelType: access.type, memberIds };
      }
    }
    throw err;
  }

  // ผู้ส่งถือว่าอ่านถึงข้อความที่ตัวเองส่งแล้ว
  await prisma.chatReadState.upsert({
    where: { channelId_userId: { channelId, userId: actor.userId } },
    update: { lastReadSeq: row.seq, lastReadAt: row.createdAt },
    create: { channelId, userId: actor.userId, orgId: actor.orgId, lastReadSeq: row.seq, lastReadAt: row.createdAt },
  });

  const [[message], author] = await Promise.all([
    hydrateMessages(actor.orgId, [row]),
    prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } }),
  ]);
  await broadcastToChannel(
    actor.orgId,
    channelId,
    { type: "chat.message", channelId, message: message!, authorName: author?.name, channelName: access.name, channelType: access.type },
    memberIds
  );
  return { message: message!, created: true, channelType: access.type, memberIds };
}

/** ยกเลิกข้อความ (unsend) — ของตัวเอง หรือแอดมินห้องลบของคนอื่นได้ */
export async function deleteMessage(actor: ChatActor, channelId: string, messageId: string): Promise<void> {
  const access = await getChannelAccess(actor, channelId);
  const message = await prisma.chatMessage.findFirst({ where: { id: messageId, orgId: actor.orgId, channelId } });
  if (!message || message.deletedAt) throw new ChatError("ไม่พบข้อความนี้", 404);
  if (message.kind !== "text") throw new ChatError("ลบข้อความระบบไม่ได้", 400);
  if (message.authorId !== actor.userId && !access.canManage) throw new ChatError("ลบได้เฉพาะข้อความที่ตัวเองส่ง", 403);

  await prisma.$transaction([
    prisma.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date() } }),
    prisma.chatReaction.deleteMany({ where: { orgId: actor.orgId, messageId } }),
    prisma.chatChannel.updateMany({ where: { orgId: actor.orgId, id: channelId, announcementId: messageId }, data: { announcementId: null } }),
  ]);
  await broadcastToChannel(actor.orgId, channelId, { type: "chat.message.deleted", channelId, messageId });
}

/** กดอีโมจิ — กดซ้ำอันเดิม = เอาออก */
export async function toggleReaction(actor: ChatActor, channelId: string, messageId: string, emoji: string): Promise<ChatReactionDTO[]> {
  await getChannelAccess(actor, channelId);
  if (!(CHAT_REACTION_EMOJIS as readonly string[]).includes(emoji)) throw new ChatError("อีโมจินี้ใช้ไม่ได้", 400);
  const message = await prisma.chatMessage.findFirst({
    where: { id: messageId, orgId: actor.orgId, channelId, deletedAt: null, kind: "text" },
    select: { id: true },
  });
  if (!message) throw new ChatError("ไม่พบข้อความนี้", 404);

  const key = { messageId_userId_emoji: { messageId, userId: actor.userId, emoji } };
  const existing = await prisma.chatReaction.findUnique({ where: key });
  if (existing) await prisma.chatReaction.delete({ where: key });
  else await prisma.chatReaction.create({ data: { messageId, userId: actor.userId, orgId: actor.orgId, emoji } }).catch(() => {});

  const reactions = await reactionsFor(actor.orgId, messageId);
  await broadcastToChannel(actor.orgId, channelId, { type: "chat.reaction", channelId, messageId, reactions });
  return reactions;
}

/** ค้นหาข้อความในห้อง (ล่าสุดก่อน) */
export async function searchMessages(actor: ChatActor, channelId: string, q: string): Promise<ChatMessageDTO[]> {
  await getChannelAccess(actor, channelId);
  const term = q.trim().slice(0, 100);
  if (term.length < 1) return [];
  const rows = await prisma.chatMessage.findMany({
    where: { orgId: actor.orgId, channelId, deletedAt: null, kind: "text", body: { contains: term, mode: "insensitive" } },
    orderBy: { seq: "desc" },
    take: 40,
  });
  return hydrateMessages(actor.orgId, rows);
}

/** ข้อความรอบ ๆ ข้อความหนึ่ง (กดผลค้นหา/กดข้อความที่ถูกตอบ แล้วกระโดดไปดู) */
export async function messagesAround(actor: ChatActor, channelId: string, messageId: string): Promise<{ messages: ChatMessageDTO[]; hasMore: boolean }> {
  await getChannelAccess(actor, channelId);
  const target = await prisma.chatMessage.findFirst({ where: { id: messageId, orgId: actor.orgId, channelId }, select: { seq: true } });
  if (!target) throw new ChatError("ไม่พบข้อความนี้", 404);
  const base = { orgId: actor.orgId, channelId };
  const [older, newer] = await Promise.all([
    prisma.chatMessage.findMany({ where: { ...base, seq: { lte: target.seq } }, orderBy: { seq: "desc" }, take: 31 }),
    prisma.chatMessage.findMany({ where: { ...base, seq: { gt: target.seq } }, orderBy: { seq: "asc" }, take: 30 }),
  ]);
  const hasMore = older.length > 30;
  return { messages: await hydrateMessages(actor.orgId, [...older.slice(0, 30).reverse(), ...newer]), hasMore };
}

export type MediaKind = "media" | "file" | "link";

/** คลังรูป/ไฟล์/ลิงก์ของห้อง (ใหม่ → เก่า, แบ่งหน้าด้วย before=<seq>) */
export async function listChannelMedia(
  actor: ChatActor,
  channelId: string,
  kind: MediaKind,
  before?: string
): Promise<{ messages: ChatMessageDTO[]; hasMore: boolean }> {
  await getChannelAccess(actor, channelId);
  const take = 60;
  const seqFilter = before ? { seq: { lt: parseSeq(before, "before") } } : {};
  const base = { orgId: actor.orgId, channelId, deletedAt: null, ...seqFilter };
  const where =
    kind === "link"
      ? { ...base, body: { contains: "http", mode: "insensitive" as const } }
      : kind === "media"
        ? { ...base, OR: [{ attachments: { array_contains: [{ kind: "image" }] } }, { attachments: { array_contains: [{ kind: "video" }] } }] }
        : { ...base, OR: [{ attachments: { array_contains: [{ kind: "file" }] } }, { attachments: { array_contains: [{ kind: "audio" }] } }] };
  const rows = await prisma.chatMessage.findMany({ where, orderBy: { seq: "desc" }, take: take + 1 });
  return { messages: await hydrateMessages(actor.orgId, rows.slice(0, take)), hasMore: rows.length > take };
}

/** คนในห้องที่ไม่ใช่ผู้ส่ง — ใช้ตัดสินว่าจะแจ้งเตือนใคร (ห้อง org = ทุกคนในบริษัท) */
export async function otherMemberIds(orgId: string, channelId: string, excludeUserId: string): Promise<string[]> {
  if (channelId === orgChannelId(orgId)) {
    const rows = await prisma.user.findMany({
      where: { orgId, isActive: true, id: { not: excludeUserId } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
  return (await channelMemberIds(orgId, channelId)).filter((id) => id !== excludeUserId);
}
