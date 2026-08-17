import "server-only";
import { prisma } from "@smartboss/database";

import { CHAT_ORG_CHANNEL_NAME } from "../constants";
import type { ChatChannelSummary } from "../types";

export type { ChatChannelSummary };

/**
 * ห้องรวมทั้งบริษัท — id คงที่ต่อบริษัท (`org-<orgId>`) แทน uuid สุ่ม เพื่อให้
 * "หาหรือสร้าง" เป็น upsert อะตอมมิกตัวเดียว กันสองคำขอพร้อมกันตอนแรกสุดสร้างซ้ำ
 * (Prisma ไม่รองรับ partial unique index ผ่าน schema เฉย ๆ ง่าย ๆ เท่านี้)
 *
 * ทุกคนในบริษัทเข้าห้องนี้ได้โดยปริยาย — **ไม่มีแถว ChatChannelMember** ต่อคน
 * (ต่างจาก dm/group) เพราะ id ห้องเข้ารหัส orgId ของผู้เรียกอยู่แล้ว การเทียบ
 * `channelId === orgChannelId(orgId)` ด้วย orgId จริงของ session ก็พอเพียง
 * กันข้ามบริษัทได้โดยไม่ต้องมีแถวสมาชิกเป็นพันแถวต่อห้อง
 */
export function orgChannelId(orgId: string): string {
  return `org-${orgId}`;
}

async function ensureOrgChannel(orgId: string, callerId: string): Promise<string> {
  const id = orgChannelId(orgId);
  await prisma.chatChannel.upsert({
    where: { id },
    update: {},
    create: { id, orgId, type: "org", name: CHAT_ORG_CHANNEL_NAME, createdById: callerId },
  });
  return id;
}

/** true = userId เข้าห้องนี้ได้จริง — ห้อง org เข้าได้เสมอ (ดูคอมเมนต์ orgChannelId),
 * ห้อง dm/group ต้องมีแถว ChatChannelMember จริง ใช้ก่อนอ่าน/ส่งข้อความทุกครั้ง
 * กันคนนอกยิง API ตรง ๆ */
export async function assertChannelMember(orgId: string, channelId: string, userId: string): Promise<void> {
  if (channelId === orgChannelId(orgId)) {
    await ensureOrgChannel(orgId, userId);
    return;
  }
  const member = await prisma.chatChannelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  });
  if (!member) {
    const err = new Error("ไม่มีสิทธิ์เข้าห้องนี้");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
}

export async function listChannelsForUser(orgId: string, userId: string): Promise<ChatChannelSummary[]> {
  const orgChanId = await ensureOrgChannel(orgId, userId);

  const memberships = await prisma.chatChannelMember.findMany({
    where: { orgId, userId },
    select: { channelId: true },
  });
  const channelIds = [orgChanId, ...memberships.map((m) => m.channelId)];

  // แถว membership ใช้บอกแค่ "เข้าได้ไหม" — สถานะอ่านแยกอยู่ใน ChatReadState
  // เดียว ใช้กับทุกประเภทห้อง (รวม org ที่ไม่มีแถว membership เอง)
  const [channels, allMembers, lastMessages, readStates] = await Promise.all([
    prisma.chatChannel.findMany({ where: { id: { in: channelIds }, archived: false } }),
    prisma.chatChannelMember.findMany({ where: { channelId: { in: channelIds } }, select: { channelId: true, userId: true } }),
    prisma.chatMessage.findMany({
      where: { channelId: { in: channelIds }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      distinct: ["channelId"],
    }),
    prisma.chatReadState.findMany({
      where: { orgId, userId, channelId: { in: channelIds } },
      select: { channelId: true, lastReadSeq: true },
    }),
  ]);

  const lastReadSeqByChannel = new Map(readStates.map((r) => [r.channelId, r.lastReadSeq]));

  // นับ unread ด้วย query เดียวสำหรับทุกห้อง (ไม่ loop ยิงทีละห้อง) — เงื่อนไข
  // ต่อห้องต่างกัน (seq > lastReadSeq ของห้องนั้น) จึงต้องเป็น OR ของแต่ละห้อง
  // ไม่มี lastReadSeq (ไม่เคยเปิดอ่านเลย) = seq filter เป็น undefined = นับทุก
  // ข้อความในห้องนั้นเป็นยังไม่อ่านทั้งหมด ตรงตามความหมายเดิม
  const unreadRows =
    channelIds.length > 0
      ? await prisma.chatMessage.findMany({
          where: {
            deletedAt: null,
            authorId: { not: userId },
            OR: channelIds.map((id) => {
              const lastReadSeq = lastReadSeqByChannel.get(id);
              return { channelId: id, seq: lastReadSeq != null ? { gt: lastReadSeq } : undefined };
            }),
          },
          select: { channelId: true },
        })
      : [];
  const unreadByChannel = new Map<string, number>();
  for (const row of unreadRows) unreadByChannel.set(row.channelId, (unreadByChannel.get(row.channelId) ?? 0) + 1);

  const membersByChannel = new Map<string, string[]>();
  for (const m of allMembers) {
    const list = membersByChannel.get(m.channelId) ?? [];
    list.push(m.userId);
    membersByChannel.set(m.channelId, list);
  }
  const lastMessageByChannel = new Map(lastMessages.map((m) => [m.channelId, m]));

  const summaries: ChatChannelSummary[] = channels.map((c) => {
    const last = lastMessageByChannel.get(c.id);
    const attachments = (last?.attachments as unknown[] | undefined) ?? [];
    return {
      id: c.id,
      type: c.type,
      name: c.name,
      memberIds: membersByChannel.get(c.id) ?? [],
      unreadCount: unreadByChannel.get(c.id) ?? 0,
      lastMessage: last
        ? { body: last.body, authorId: last.authorId, createdAt: last.createdAt.toISOString(), hasAttachment: attachments.length > 0 }
        : null,
    };
  });

  // ห้องที่มีข้อความล่าสุดขึ้นก่อน, ห้องที่ยังไม่มีข้อความเลยไปท้ายสุดตามชื่อ/ประเภท
  summaries.sort((a, b) => {
    const at = a.lastMessage?.createdAt ?? "";
    const bt = b.lastMessage?.createdAt ?? "";
    if (at !== bt) return bt.localeCompare(at);
    if (a.type === "org") return -1;
    if (b.type === "org") return 1;
    return 0;
  });
  return summaries;
}

/** หา DM ที่มีอยู่แล้วระหว่างสองคนนี้ ถ้ามีคืนห้องเดิม ไม่สร้างซ้ำ */
export async function getOrCreateDm(orgId: string, userAId: string, userBId: string): Promise<string> {
  if (userAId === userBId) throw new Error("แชทกับตัวเองไม่ได้");

  const existing = await prisma.chatChannel.findFirst({
    where: {
      orgId,
      type: "dm",
      members: { some: { userId: userAId } },
      AND: { members: { some: { userId: userBId } } },
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.chatChannel.create({
    data: {
      orgId,
      type: "dm",
      createdById: userAId,
      members: {
        create: [
          { userId: userAId, orgId },
          { userId: userBId, orgId },
        ],
      },
    },
  });
  return created.id;
}

export async function createGroup(orgId: string, callerId: string, name: string, memberIds: string[]): Promise<string> {
  const allIds = Array.from(new Set([callerId, ...memberIds]));
  const created = await prisma.chatChannel.create({
    data: {
      orgId,
      type: "group",
      name: name.trim().slice(0, 100) || "กลุ่มไม่มีชื่อ",
      createdById: callerId,
      members: { create: allIds.map((userId) => ({ userId, orgId })) },
    },
  });
  return created.id;
}

/** ล้าง unread badge — lastReadSeq = seq ล่าสุดของห้อง ณ ตอนนี้ (ไม่ใช่แค่ "now"
 * เพราะ unread เทียบด้วย seq ไม่ใช่เวลา) แถวเกิดแบบ lazy ตอนเปิดอ่านครั้งแรก */
export async function markChannelRead(channelId: string, userId: string, orgId: string): Promise<void> {
  const latest = await prisma.chatMessage.findFirst({
    where: { channelId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  await prisma.chatReadState.upsert({
    where: { channelId_userId: { channelId, userId } },
    update: { lastReadSeq: latest?.seq, lastReadAt: new Date() },
    create: { channelId, userId, orgId, lastReadSeq: latest?.seq, lastReadAt: new Date() },
  });
}

/** รายชื่อเพื่อนร่วมบริษัทสำหรับตัวเลือก "เริ่มแชทใหม่ / สร้างกลุ่ม" */
export async function listOrgUsersForPicker(orgId: string, excludeUserId: string) {
  return prisma.user.findMany({
    where: { orgId, isActive: true, id: { not: excludeUserId } },
    select: { id: true, name: true, avatarUrl: true },
    orderBy: { name: "asc" },
  });
}
