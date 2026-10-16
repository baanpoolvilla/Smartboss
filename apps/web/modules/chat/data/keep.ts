import "server-only";
import { prisma } from "@smartboss/database";

import {
  KEEP_CHANNEL_NAME,
  KEEP_CHANNEL_PREFIX,
  KEEP_QUOTA_BYTES,
  type ChatAttachment,
  type ChatKeepCollectionDTO,
  type ChatKeepItemDTO,
  type ChatKeepKind,
} from "../types";
import { getChannelAccess } from "./channels";
import { deleteOrphanFiles } from "./albums";
import { ChatError, type ChatActor } from "./serialize";

/*
 * Keep (แบบ LINE) — 2 ส่วน:
 *   1. ห้อง "Keep Memo" ของแต่ละคน (แชทกับตัวเอง) — chat.channels id คงที่ keep-<userId> สมาชิกคนเดียว
 *      (แบบเดียวกับห้อง "ระบบลงเวลา" clock-<userId>) · ส่งอะไรเข้าห้องนี้ = เก็บลงคลังให้อัตโนมัติ
 *   2. คลัง Keep (chat.keep_items) — ของที่เก็บไว้ทั้งหมด แยกตามประเภท + คอลเลกชัน
 *      กด "Keep" ที่ข้อความในห้องไหนก็ได้ = เก็บลงคลัง (ไม่เข้าห้อง Memo — เหมือน LINE)
 * เห็นแค่เจ้าของเสมอ: ห้อง Memo มีสมาชิกคนเดียว (getChannelAccess ต้องเป็นสมาชิก แอดมินแชทก็เปิดไม่ได้)
 * คลังกรอง userId ของผู้เรียกทุก query · ไฟล์ในคลังไม่หมดอายุ (keptUrls → media-retention.ts / serialize.ts)
 */

export function keepChannelId(userId: string): string {
  return `${KEEP_CHANNEL_PREFIX}${userId}`;
}

const g = globalThis as unknown as { __chatKeepEnsured?: Set<string> };
const ensured = (g.__chatKeepEnsured ??= new Set<string>());

/**
 * หา/สร้างห้อง Keep Memo ของคนนี้ — ครั้งแรกปักหมุดไว้บนสุดให้ (เลิกปักเองได้ ระบบไม่ปักกลับ)
 * จำไว้ในโปรเซส ไม่ต้องยิง upsert ทุกครั้งที่โหลดรายการห้อง
 */
export async function ensureKeepChannel(orgId: string, userId: string): Promise<string> {
  const id = keepChannelId(userId);
  if (ensured.has(id)) return id;
  const existing = await prisma.chatChannel.findFirst({ where: { id, orgId }, select: { id: true, archived: true } });
  if (!existing) {
    await prisma.chatChannel
      .create({
        data: {
          id,
          orgId,
          type: "group",
          name: KEEP_CHANNEL_NAME,
          createdById: userId,
          members: { create: [{ userId, orgId, role: "admin" }] },
        },
      })
      .catch((err: { code?: string }) => {
        if (err.code !== "P2002") throw err; // สองคำขอพร้อมกัน — อีกอันสร้างไปแล้ว
      });
    await prisma.chatReadState.upsert({
      where: { channelId_userId: { channelId: id, userId } },
      update: {},
      create: { channelId: id, userId, orgId, pinned: true },
    });
  } else if (existing.archived) {
    await prisma.chatChannel.update({ where: { id }, data: { archived: false } });
  }
  ensured.add(id);
  return id;
}

// ─── สร้างรายการจากข้อความ ──────────────────────────────────────────────────

const URL_RE = /https?:\/\/\S+/i;

interface ItemDraft {
  kind: ChatKeepKind;
  body: string | null;
  attachment: ChatAttachment | null;
  size: number;
  dedupeKey: string;
}

/** ข้อความหนึ่ง → รายการในคลัง: ข้อความตัวหนังสือ 1 รายการ (มีลิงก์ = "link") + ไฟล์ละ 1 รายการ (ข้ามสติกเกอร์/ไฟล์หมดอายุ) */
function draftsFrom(messageId: string, body: string | null, attachments: ChatAttachment[]): ItemDraft[] {
  const out: ItemDraft[] = [];
  const text = body?.trim();
  if (text) {
    out.push({ kind: URL_RE.test(text) ? "link" : "text", body: text, attachment: null, size: 0, dedupeKey: `${messageId}:text` });
  }
  for (const a of attachments) {
    if (a.kind === "sticker" || a.expired || !a.url) continue;
    const { expiresAt: _drop, ...clean } = a;
    out.push({
      kind: a.kind === "image" || a.kind === "video" || a.kind === "audio" ? a.kind : "file",
      body: null,
      attachment: clean,
      size: a.size || 0,
      dedupeKey: `${messageId}:${a.url}`,
    });
  }
  return out;
}

async function usedBytes(orgId: string, userId: string): Promise<number> {
  const agg = await prisma.chatKeepItem.aggregate({ where: { orgId, userId }, _sum: { size: true } });
  return agg._sum.size ?? 0;
}

async function insertDrafts(
  actor: ChatActor,
  drafts: ItemDraft[],
  source: { channelId: string; messageId: string; authorId: string; label: string | null }
): Promise<number> {
  if (drafts.length === 0) return 0;
  const already = new Set(
    (
      await prisma.chatKeepItem.findMany({
        where: { orgId: actor.orgId, userId: actor.userId, dedupeKey: { in: drafts.map((d) => d.dedupeKey) } },
        select: { dedupeKey: true },
      })
    ).map((r) => r.dedupeKey)
  );
  const fresh = drafts.filter((d) => !already.has(d.dedupeKey));
  if (fresh.length === 0) return 0;
  const adding = fresh.reduce((s, d) => s + d.size, 0);
  if (adding > 0 && (await usedBytes(actor.orgId, actor.userId)) + adding > KEEP_QUOTA_BYTES) {
    throw new ChatError("พื้นที่ Keep เต็มแล้ว (1 GB) — ลบของที่ไม่ใช้ในคลัง Keep ก่อน", 400);
  }
  const res = await prisma.chatKeepItem.createMany({
    data: fresh.map((d) => ({
      orgId: actor.orgId,
      userId: actor.userId,
      kind: d.kind,
      body: d.body,
      attachment: (d.attachment ?? undefined) as never,
      size: d.size,
      sourceChannelId: source.channelId,
      sourceMessageId: source.messageId,
      sourceAuthorId: source.authorId,
      sourceLabel: source.label,
      dedupeKey: d.dedupeKey,
    })),
    skipDuplicates: true,
  });
  return res.count;
}

/**
 * ข้อความที่เพิ่งส่งเข้าห้อง Keep Memo ของตัวเอง → เก็บลงคลังทันที (createMessage เรียก)
 * พื้นที่เต็ม = ข้อความยังส่งได้ แค่ไม่เข้าคลัง (ไม่ throw ให้การส่งพัง)
 */
export async function autoKeepOwnMessage(
  actor: ChatActor,
  channelId: string,
  row: { id: string; body: string | null; attachments: unknown }
): Promise<void> {
  if (channelId !== keepChannelId(actor.userId)) return;
  try {
    const drafts = draftsFrom(row.id, row.body, (row.attachments as ChatAttachment[] | null) ?? []);
    await insertDrafts(actor, drafts, { channelId, messageId: row.id, authorId: actor.userId, label: KEEP_CHANNEL_NAME });
  } catch (err) {
    if (!(err instanceof ChatError)) console.error("[chat] auto keep failed", err);
  }
}

/** ปุ่ม "Keep" ที่ข้อความในห้องไหนก็ได้ (ที่ตัวเองเข้าได้) — คืนจำนวนรายการที่เพิ่ม (0 = เก็บไว้แล้ว) */
export async function keepMessage(actor: ChatActor, channelId: string, messageId: string): Promise<{ added: number }> {
  const access = await getChannelAccess(actor, channelId);
  const msg = await prisma.chatMessage.findFirst({
    where: { id: messageId, orgId: actor.orgId, channelId, deletedAt: null },
    select: { id: true, kind: true, body: true, attachments: true, authorId: true },
  });
  if (!msg) throw new ChatError("ไม่พบข้อความนี้", 404);
  let body = msg.body;
  let attachments = (msg.attachments as ChatAttachment[] | null) ?? [];
  if (msg.kind === "note") {
    const note = await prisma.chatNote.findFirst({ where: { orgId: actor.orgId, messageId }, select: { body: true, attachments: true } });
    if (!note) throw new ChatError("โน้ตนี้ถูกลบไปแล้ว", 404);
    body = note.body;
    attachments = (note.attachments as ChatAttachment[] | null) ?? [];
  } else if (msg.kind !== "text") {
    throw new ChatError("ข้อความระบบเก็บไว้ใน Keep ไม่ได้", 400);
  }
  const drafts = draftsFrom(msg.id, body, attachments);
  if (drafts.length === 0) throw new ChatError("ข้อความนี้ไม่มีอะไรให้เก็บ (ไฟล์อาจหมดอายุแล้ว)", 400);
  // แชทส่วนตัวไม่มีชื่อห้อง — ใช้ชื่ออีกฝั่ง ("แชทกับ ...") ไม่ใช่คนส่งข้อความ (อาจเป็นเราเอง)
  let label = access.name;
  if (access.type === "dm") {
    const other = await prisma.chatChannelMember.findFirst({
      where: { orgId: actor.orgId, channelId, userId: { not: actor.userId } },
      select: { userId: true },
    });
    const user = other ? await prisma.user.findFirst({ where: { orgId: actor.orgId, id: other.userId }, select: { name: true } }) : null;
    label = user ? `แชทกับ ${user.name}` : "แชทส่วนตัว";
  }
  return { added: await insertDrafts(actor, drafts, { channelId, messageId, authorId: msg.authorId, label }) };
}

// ─── คลัง Keep ─────────────────────────────────────────────────────────────

const PAGE = 60;

function toDTO(r: {
  id: string;
  kind: string;
  body: string | null;
  attachment: unknown;
  size: number;
  sourceChannelId: string | null;
  sourceMessageId: string | null;
  sourceAuthorId: string | null;
  sourceLabel: string | null;
  collectionIds: string[];
  createdAt: Date;
}): ChatKeepItemDTO {
  const fromKeepMemo = r.sourceChannelId?.startsWith(KEEP_CHANNEL_PREFIX) ?? false;
  return {
    id: r.id,
    kind: r.kind as ChatKeepKind,
    body: r.body,
    attachment: (r.attachment as ChatAttachment | null) ?? null,
    size: r.size,
    source: r.sourceChannelId || r.sourceLabel
      ? { channelId: r.sourceChannelId, messageId: r.sourceMessageId, label: r.sourceLabel, authorId: r.sourceAuthorId, fromKeepMemo }
      : null,
    collectionIds: r.collectionIds,
    createdAt: r.createdAt.toISOString(),
  };
}

export const KEEP_TABS = ["all", "image", "video", "link", "file", "text"] as const;
export type KeepTab = (typeof KEEP_TABS)[number];

export async function listKeep(
  actor: ChatActor,
  opts: { tab?: string; q?: string; collectionId?: string; before?: string }
): Promise<{ items: ChatKeepItemDTO[]; hasMore: boolean; usedBytes: number; quotaBytes: number; collections: ChatKeepCollectionDTO[] }> {
  const tab = (KEEP_TABS as readonly string[]).includes(opts.tab ?? "") ? (opts.tab as KeepTab) : "all";
  const q = opts.q?.trim().slice(0, 100);
  const before = opts.before ? new Date(opts.before) : null;
  const kindFilter =
    tab === "all" ? {} : tab === "file" ? { kind: { in: ["file", "audio"] } } : { kind: tab };
  const rows = await prisma.chatKeepItem.findMany({
    where: {
      orgId: actor.orgId,
      userId: actor.userId,
      ...kindFilter,
      ...(opts.collectionId ? { collectionIds: { has: opts.collectionId } } : {}),
      ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
      ...(q
        ? {
            OR: [
              { body: { contains: q, mode: "insensitive" as const } },
              { sourceLabel: { contains: q, mode: "insensitive" as const } },
              { attachment: { path: ["name"], string_contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: PAGE + 1,
  });
  const [used, collections] = await Promise.all([usedBytes(actor.orgId, actor.userId), listCollections(actor)]);
  return { items: rows.slice(0, PAGE).map(toDTO), hasMore: rows.length > PAGE, usedBytes: used, quotaBytes: KEEP_QUOTA_BYTES, collections };
}

async function ownItem(actor: ChatActor, id: string) {
  const row = await prisma.chatKeepItem.findFirst({ where: { id, orgId: actor.orgId, userId: actor.userId }, select: { id: true } });
  if (!row) throw new ChatError("ไม่พบรายการนี้", 404);
  return row;
}

/**
 * ลบออกจากคลัง — ไม่แตะข้อความต้นทาง · ไฟล์ที่ไม่มีใครใช้แล้ว (ไม่อยู่ใน Keep ของใคร ไม่อยู่ในอัลบั้ม/โน้ต
 * และข้อความต้นทางหมดอายุไปแล้ว) ลบทิ้งด้วย ไม่งั้นค้างกินพื้นที่บริษัทตลอดไป
 */
export async function deleteKeepItem(actor: ChatActor, id: string): Promise<void> {
  await ownItem(actor, id);
  const row = await prisma.chatKeepItem.delete({ where: { id }, select: { attachment: true } });
  const att = row.attachment as ChatAttachment | null;
  if (att?.url) await deleteOrphanFiles(actor.orgId, [att.url, ...(att.thumbUrl ? [att.thumbUrl] : [])]).catch(() => {});
}

export async function setKeepItemCollections(actor: ChatActor, id: string, collectionIds: unknown): Promise<string[]> {
  await ownItem(actor, id);
  const wanted = Array.isArray(collectionIds) ? collectionIds.filter((c): c is string => typeof c === "string").slice(0, 50) : [];
  const valid = (
    await prisma.chatKeepCollection.findMany({ where: { orgId: actor.orgId, userId: actor.userId, id: { in: wanted } }, select: { id: true } })
  ).map((c) => c.id);
  await prisma.chatKeepItem.update({ where: { id }, data: { collectionIds: valid } });
  return valid;
}

export async function listCollections(actor: ChatActor): Promise<ChatKeepCollectionDTO[]> {
  const [cols, counts] = await Promise.all([
    prisma.chatKeepCollection.findMany({ where: { orgId: actor.orgId, userId: actor.userId }, orderBy: { createdAt: "asc" } }),
    prisma.$queryRaw<{ cid: string; n: bigint }[]>`
      SELECT unnest(collection_ids) AS cid, COUNT(*) AS n
      FROM chat.keep_items
      WHERE org_id = ${actor.orgId} AND user_id = ${actor.userId}
      GROUP BY cid`,
  ]);
  const byId = new Map(counts.map((c) => [c.cid, Number(c.n)]));
  return cols.map((c) => ({ id: c.id, name: c.name, count: byId.get(c.id) ?? 0 }));
}

const MAX_COLLECTIONS = 100;

export async function createCollection(actor: ChatActor, name: unknown): Promise<ChatKeepCollectionDTO> {
  const clean = typeof name === "string" ? name.trim().slice(0, 50) : "";
  if (!clean) throw new ChatError("ตั้งชื่อคอลเลกชันก่อน", 400);
  const n = await prisma.chatKeepCollection.count({ where: { orgId: actor.orgId, userId: actor.userId } });
  if (n >= MAX_COLLECTIONS) throw new ChatError(`สร้างคอลเลกชันได้ไม่เกิน ${MAX_COLLECTIONS} อัน`, 400);
  const row = await prisma.chatKeepCollection.create({ data: { orgId: actor.orgId, userId: actor.userId, name: clean } });
  return { id: row.id, name: row.name, count: 0 };
}

async function ownCollection(actor: ChatActor, id: string) {
  const row = await prisma.chatKeepCollection.findFirst({ where: { id, orgId: actor.orgId, userId: actor.userId }, select: { id: true } });
  if (!row) throw new ChatError("ไม่พบคอลเลกชันนี้", 404);
}

export async function renameCollection(actor: ChatActor, id: string, name: unknown): Promise<void> {
  await ownCollection(actor, id);
  const clean = typeof name === "string" ? name.trim().slice(0, 50) : "";
  if (!clean) throw new ChatError("ตั้งชื่อคอลเลกชันก่อน", 400);
  await prisma.chatKeepCollection.update({ where: { id }, data: { name: clean } });
}

/** ลบคอลเลกชัน — ของข้างในไม่หาย แค่ไม่อยู่ในคอลเลกชันนี้แล้ว */
export async function deleteCollection(actor: ChatActor, id: string): Promise<void> {
  await ownCollection(actor, id);
  await prisma.$executeRaw`
    UPDATE chat.keep_items SET collection_ids = array_remove(collection_ids, ${id})
    WHERE org_id = ${actor.orgId} AND user_id = ${actor.userId} AND ${id} = ANY(collection_ids)`;
  await prisma.chatKeepCollection.delete({ where: { id } });
}

// ─── ไฟล์ที่อยู่ใน Keep (ห้ามหมดอายุ/ห้ามลบ) ─────────────────────────────────────

/** url (ไฟล์หรือรูปย่อ) ที่มีคนเก็บไว้ใน Keep — งานเก็บกวาดไฟล์ต้องไม่ลบไฟล์พวกนี้ */
export async function keptUrls(orgId: string, urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const rows = await prisma.$queryRaw<{ url: string | null; thumb: string | null }[]>`
    SELECT attachment->>'url' AS url, attachment->>'thumbUrl' AS thumb
    FROM chat.keep_items
    WHERE org_id = ${orgId}
      AND attachment IS NOT NULL
      AND (attachment->>'url' = ANY(${urls}) OR attachment->>'thumbUrl' = ANY(${urls}))`;
  return new Set(rows.flatMap((r) => [r.url, r.thumb]).filter((u): u is string => !!u));
}
