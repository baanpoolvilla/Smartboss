import "server-only";
import { prisma } from "@smartboss/database";

import type { ChatAttachment, ChatAttachmentKind, ChatMessageDTO, ChatNotePreview, ChatReactionDTO, ChatReplyPreview, ChatAlbumCard, ChatTaskCard } from "../types";
import { EXPIRING_KINDS, mediaExpiresAt } from "../lib/retention";
import { isKeepChannelId } from "../types";

/** ข้อผิดพลาดที่มีสถานะ HTTP — route แปลงเป็นคำตอบให้เอง (ดู lib/respond.ts) */
export class ChatError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

/** ผู้ที่กำลังทำรายการ — isChatAdmin = มีสิทธิ์ chat.manage (จัดการได้ทุกห้องในบริษัท) */
export interface ChatActor {
  orgId: string;
  userId: string;
  isChatAdmin: boolean;
  /** CEO / ผู้ดูแลระบบสูงสุด / ฝ่าย IT (ADMIN) — เปลี่ยนชื่อได้ทุกห้อง (ยกเว้นแชทส่วนตัว) */
  isTopAdmin?: boolean;
  /** สิทธิ์ chat.sticker.manage — แยกจาก isChatAdmin: คนที่ดูแลสติกเกอร์ (IT/การตลาด) ไม่จำเป็นต้องคุมทุกห้อง */
  canManageStickers?: boolean;
}

export interface MessageRow {
  id: string;
  seq: bigint;
  channelId: string;
  authorId: string;
  kind: string;
  body: string | null;
  attachments: unknown;
  replyToId: string | null;
  mentions: string[];
  clientId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  /** การ์ดอัลบั้ม (kind "album") — { albumId, count, created, items } */
  meta?: unknown;
}

/** ข้อความย่อของโน้ต (บรรทัดแรก ๆ) — ใช้เป็นเนื้อการ์ดในห้อง, รายการห้อง, แจ้งเตือน */
export function noteExcerpt(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 140);
}

export function notePreview(note: { id: string; body: string; attachments: unknown }): ChatNotePreview {
  const images = ((note.attachments as ChatAttachment[] | null) ?? []).filter((a) => a.kind === "image");
  return {
    id: note.id,
    excerpt: noteExcerpt(note.body),
    thumbUrl: images[0] ? (images[0].thumbUrl ?? images[0].url) : null,
    imageCount: images.length,
  };
}

export function firstAttachmentKind(attachments: unknown): ChatAttachmentKind | null {
  const list = (attachments as ChatAttachment[] | null) ?? [];
  return list[0]?.kind ?? null;
}

function groupReactions(rows: { messageId: string; userId: string; emoji: string }[]): Map<string, ChatReactionDTO[]> {
  const byMessage = new Map<string, Map<string, string[]>>();
  for (const r of rows) {
    const byEmoji = byMessage.get(r.messageId) ?? new Map<string, string[]>();
    const users = byEmoji.get(r.emoji) ?? [];
    users.push(r.userId);
    byEmoji.set(r.emoji, users);
    byMessage.set(r.messageId, byEmoji);
  }
  const out = new Map<string, ChatReactionDTO[]>();
  for (const [messageId, byEmoji] of byMessage) {
    out.set(
      messageId,
      Array.from(byEmoji, ([emoji, userIds]) => ({ emoji, userIds }))
    );
  }
  return out;
}

export async function reactionsFor(orgId: string, messageId: string): Promise<ChatReactionDTO[]> {
  const rows = await prisma.chatReaction.findMany({
    where: { orgId, messageId },
    orderBy: { createdAt: "asc" },
    select: { messageId: true, userId: true, emoji: true },
  });
  return groupReactions(rows).get(messageId) ?? [];
}

/**
 * แปลงแถวเป็น DTO พร้อม "ตอบกลับข้อความไหน" และอีโมจิ — query รวมครั้งเดียวต่อชุด
 * ไม่ยิงทีละข้อความ ข้อความที่ยกเลิกแล้วเหลือแค่ร่องรอย (ไม่ส่งเนื้อหาออกไป)
 */
/** การ์ดงาน (kind "task") — meta ที่ data/task-cards.ts เขียนไว้ · ข้อมูลไม่ครบ = null (การ์ดขึ้นเป็นข้อความธรรมดา) */
function taskCard(row: MessageRow): ChatTaskCard | null {
  const m = row.meta && typeof row.meta === "object" ? (row.meta as Partial<ChatTaskCard>) : null;
  if (!m || typeof m.taskId !== "string" || typeof m.title !== "string") return null;
  const link = typeof m.link === "string" && m.link.startsWith("/") ? m.link : `/report-task/tasks?task=${encodeURIComponent(m.taskId)}`;
  return { taskId: m.taskId, title: m.title, dueDate: typeof m.dueDate === "string" ? m.dueDate : null, link };
}

export async function hydrateMessages(orgId: string, rows: MessageRow[]): Promise<ChatMessageDTO[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const replyIds = Array.from(new Set(rows.map((r) => r.replyToId).filter((id): id is string => Boolean(id))));

  const noteMessageIds = rows.filter((r) => r.kind === "note").map((r) => r.id);
  const albumMeta = (r: MessageRow) => (r.kind === "album" && r.meta && typeof r.meta === "object" ? (r.meta as Partial<ChatAlbumCard>) : null);
  const albumIds = Array.from(new Set(rows.map((r) => albumMeta(r)?.albumId).filter((id): id is string => typeof id === "string")));
  const [reactionRows, replyRows, noteRows, albumRows] = await Promise.all([
    prisma.chatReaction.findMany({
      where: { orgId, messageId: { in: ids } },
      orderBy: { createdAt: "asc" },
      select: { messageId: true, userId: true, emoji: true },
    }),
    replyIds.length > 0
      ? prisma.chatMessage.findMany({
          where: { orgId, id: { in: replyIds } },
          select: { id: true, authorId: true, body: true, attachments: true, deletedAt: true },
        })
      : Promise.resolve([]),
    noteMessageIds.length > 0
      ? prisma.chatNote.findMany({
          where: { orgId, messageId: { in: noteMessageIds } },
          select: { id: true, body: true, attachments: true, messageId: true },
        })
      : Promise.resolve([]),
    // ชื่ออัลบั้มปัจจุบัน — ไม่เจอ = ถูกลบไปแล้ว (การ์ดขึ้น "อัลบั้มนี้ถูกลบแล้ว")
    albumIds.length > 0
      ? prisma.chatAlbum.findMany({ where: { orgId, id: { in: albumIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const albumName = new Map(albumRows.map((a) => [a.id, a.name]));
  const albumCard = (row: MessageRow): ChatAlbumCard | null => {
    const m = albumMeta(row);
    const name = m?.albumId ? albumName.get(m.albumId) : undefined;
    if (!m?.albumId || name === undefined) return null;
    return {
      albumId: m.albumId,
      name,
      count: typeof m.count === "number" ? m.count : 0,
      created: m.created === true,
      items: Array.isArray(m.items) ? m.items.slice(0, 5) : [],
    };
  };
  const noteByMessage = new Map(noteRows.map((n) => [n.messageId!, notePreview(n)]));

  const reactions = groupReactions(reactionRows);

  // ไฟล์ที่บันทึกลงอัลบั้มแล้วไม่หมดอายุ — ไม่ต้องขึ้นป้ายเตือน
  const expiringUrls = rows.flatMap((r) =>
    ((r.attachments as ChatAttachment[] | null) ?? []).filter((a) => EXPIRING_KINDS.has(a.kind) && !a.expired).map((a) => a.url)
  );
  const kept = new Set(
    expiringUrls.length > 0
      ? (await prisma.chatAlbumItem.findMany({ where: { orgId, url: { in: expiringUrls } }, select: { url: true } })).map((i) => i.url)
      : []
  );
  // ห้อง Keep Memo ไม่หมดอายุ (media-retention.ts ข้าม) — ไม่ขึ้นป้ายเตือน
  const withExpiry = (row: MessageRow): ChatAttachment[] =>
    ((row.attachments as ChatAttachment[] | null) ?? []).map((a) =>
      EXPIRING_KINDS.has(a.kind) && !a.expired && !kept.has(a.url) && !isKeepChannelId(row.channelId)
        ? { ...a, expiresAt: mediaExpiresAt(row.createdAt).toISOString() }
        : a
    );
  const replies = new Map<string, ChatReplyPreview>(
    replyRows.map((r) => [
      r.id,
      {
        id: r.id,
        authorId: r.authorId,
        body: r.deletedAt ? null : (r.body?.slice(0, 200) ?? null),
        attachmentKind: r.deletedAt ? null : firstAttachmentKind(r.attachments),
        deleted: Boolean(r.deletedAt),
      },
    ])
  );

  return rows.map((row) => {
    const deleted = Boolean(row.deletedAt);
    return {
      id: row.id,
      seq: row.seq.toString(),
      channelId: row.channelId,
      authorId: row.authorId,
      kind: row.kind,
      ...(row.kind === "note" ? { note: deleted ? null : (noteByMessage.get(row.id) ?? null) } : {}),
      ...(row.kind === "album" ? { album: deleted ? null : albumCard(row) } : {}),
      ...(row.kind === "task" ? { task: deleted ? null : taskCard(row) } : {}),
      body: deleted ? null : row.body,
      attachments: deleted ? [] : withExpiry(row),
      replyTo: deleted || !row.replyToId ? null : (replies.get(row.replyToId) ?? null),
      mentions: deleted ? [] : row.mentions,
      reactions: deleted ? [] : (reactions.get(row.id) ?? []),
      clientId: row.clientId,
      deleted,
      createdAt: row.createdAt.toISOString(),
    };
  });
}
