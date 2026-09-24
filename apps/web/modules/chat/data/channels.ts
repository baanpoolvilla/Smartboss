import "server-only";
import { prisma } from "@smartboss/database";

import { publishToOrg, publishToUsers } from "@/lib/realtime/server";
import { CHAT_ORG_CHANNEL_NAME } from "../constants";
import type { ChatChannelDetail, ChatChannelSummary, ChatRealtimeEvent } from "../types";
import { ChatError, firstAttachmentKind, hydrateMessages, type ChatActor } from "./serialize";

export type { ChatChannelSummary };

/*
 * ⚠ ขายให้หลายบริษัท — ทุก query ในไฟล์นี้กรอง orgId ของผู้เรียกเสมอ และ id ที่มาจาก
 * ภายนอก (channelId, userId ที่จะเพิ่มเข้ากลุ่ม ฯลฯ) ต้องถูกตรวจว่าอยู่บริษัทเดียวกัน
 * ก่อนใช้ทุกครั้ง อย่าเชื่อ id จาก client ตรง ๆ
 */

const MAX_GROUP_MEMBERS = 500;

/**
 * ห้องรวมทั้งบริษัท — id คงที่ต่อบริษัท (`org-<orgId>`) แทน uuid สุ่ม เพื่อให้
 * "หาหรือสร้าง" เป็น upsert อะตอมมิกตัวเดียว กันสองคำขอพร้อมกันตอนแรกสุดสร้างซ้ำ
 *
 * ทุกคนในบริษัทเข้าห้องนี้ได้โดยปริยาย — **ไม่มีแถว ChatChannelMember** ต่อคน
 * (ต่างจาก dm/group) เพราะ id ห้องเข้ารหัส orgId ของผู้เรียกอยู่แล้ว
 */
export function orgChannelId(orgId: string): string {
  return `org-${orgId}`;
}

const orgChannelCache = globalThis as unknown as { __chatOrgChannels?: Set<string> };
const ensuredOrgs = (orgChannelCache.__chatOrgChannels ??= new Set<string>());

async function ensureOrgChannel(orgId: string, callerId: string): Promise<string> {
  const id = orgChannelId(orgId);
  // สร้างครั้งเดียวต่อบริษัท — จำไว้ในโปรเซส ไม่ต้องยิง upsert ทุกคำขอ
  if (ensuredOrgs.has(orgId)) return id;
  await prisma.chatChannel.upsert({
    where: { id },
    update: {},
    create: { id, orgId, type: "org", name: CHAT_ORG_CHANNEL_NAME, createdById: callerId },
  });
  ensuredOrgs.add(orgId);
  return id;
}

interface ChannelAccess {
  id: string;
  type: string;
  name: string | null;
  departmentId: string | null;
  role: "admin" | "member";
  canManage: boolean;
}

/** ตรวจว่าผู้ใช้เข้าห้องนี้ได้ (และห้องอยู่บริษัทเดียวกัน) — ใช้ก่อนอ่าน/เขียนทุกครั้ง */
export async function getChannelAccess(actor: ChatActor, channelId: string): Promise<ChannelAccess> {
  if (channelId === orgChannelId(actor.orgId)) {
    await ensureOrgChannel(actor.orgId, actor.userId);
    return { id: channelId, type: "org", name: CHAT_ORG_CHANNEL_NAME, departmentId: null, role: "member", canManage: actor.isChatAdmin };
  }
  const channel = await prisma.chatChannel.findFirst({
    where: { id: channelId, orgId: actor.orgId, archived: false },
    select: { id: true, type: true, name: true, departmentId: true, members: { where: { userId: actor.userId }, select: { role: true } } },
  });
  const member = channel?.members[0];
  if (!channel || !member) throw new ChatError("ไม่มีสิทธิ์เข้าห้องนี้", 403);
  const role = member.role === "admin" ? "admin" : "member";
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    departmentId: channel.departmentId,
    role,
    canManage: channel.type !== "dm" && (role === "admin" || actor.isChatAdmin),
  };
}

/** คงชื่อเดิมไว้ให้โค้ดเก่า — เช็คสิทธิ์อย่างเดียว */
export async function assertChannelMember(orgId: string, channelId: string, userId: string): Promise<void> {
  await getChannelAccess({ orgId, userId, isChatAdmin: false }, channelId);
}

/** สมาชิกห้อง (ไม่รวมห้อง org ที่ใช้ publishToOrg แทน) */
export async function channelMemberIds(orgId: string, channelId: string): Promise<string[]> {
  const rows = await prisma.chatChannelMember.findMany({ where: { orgId, channelId }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/** ส่งเหตุการณ์ของห้องนี้ถึงทุกคนที่อยู่ในห้อง (ห้อง org = ทั้งบริษัทผ่านช่องเดียว) */
export async function broadcastToChannel(orgId: string, channelId: string, event: ChatRealtimeEvent, memberIds?: string[]) {
  if (channelId === orgChannelId(orgId)) {
    publishToOrg(orgId, event);
    return;
  }
  publishToUsers(memberIds ?? (await channelMemberIds(orgId, channelId)), event);
}

async function activeOrgUserIds(orgId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.user.findMany({ where: { orgId, isActive: true, id: { in: ids } }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function userNames(ids: string[]): Promise<Map<string, string>> {
  const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** ข้อความระบบ ("สมชายเพิ่มนภาเข้ากลุ่ม") — บันทึกแล้วส่งสดทันที */
export async function postSystemMessage(orgId: string, channelId: string, actorId: string, body: string): Promise<void> {
  const row = await prisma.chatMessage.create({ data: { orgId, channelId, authorId: actorId, kind: "system", body } });
  const [message] = await hydrateMessages(orgId, [row]);
  await broadcastToChannel(orgId, channelId, { type: "chat.message", channelId, message: message! });
}

// ─── กลุ่มประจำแผนก ────────────────────────────────────────────────────────

const DEPT_SYNC_INTERVAL_MS = 60_000;
const g = globalThis as unknown as { __chatDeptSyncAt?: Map<string, number> };

/**
 * สร้าง/ซิงก์กลุ่มแชทประจำแผนกจาก core.users.department_id + หัวหน้าแผนก
 * สมาชิก = พนักงานที่ active ในแผนก + หัวหน้าแผนก (เป็นแอดมินกลุ่ม) ย้ายแผนกแล้ว
 * ย้ายกลุ่มตาม แผนกถูกลบ = เก็บกลุ่มเข้าคลัง (archived) ไม่ลบข้อความทิ้ง
 *
 * เรียกตอนโหลดรายการห้อง แต่ทำจริงไม่เกินนาทีละครั้งต่อบริษัทต่อโปรเซส
 */
export async function syncDepartmentChannels(orgId: string, actorId: string, force = false): Promise<void> {
  const cache = (g.__chatDeptSyncAt ??= new Map());
  const last = cache.get(orgId) ?? 0;
  if (!force && Date.now() - last < DEPT_SYNC_INTERVAL_MS) return;
  cache.set(orgId, Date.now());

  try {
    const [departments, users, heads, channels] = await Promise.all([
      prisma.department.findMany({ where: { orgId }, select: { id: true, name: true } }),
      prisma.user.findMany({ where: { orgId, isActive: true, departmentId: { not: null } }, select: { id: true, departmentId: true } }),
      prisma.departmentHead.findMany({ where: { department: { orgId }, user: { orgId, isActive: true } }, select: { departmentId: true, userId: true } }),
      prisma.chatChannel.findMany({
        where: { orgId, departmentId: { not: null } },
        select: { id: true, name: true, departmentId: true, archived: true, members: { select: { userId: true, role: true } } },
      }),
    ]);

    const deptIds = new Set(departments.map((d) => d.id));
    const byDept = new Map(channels.map((c) => [c.departmentId!, c]));
    const changed: string[] = [];

    for (const dept of departments) {
      const headIds = new Set(heads.filter((h) => h.departmentId === dept.id).map((h) => h.userId));
      const memberIds = new Set([...users.filter((u) => u.departmentId === dept.id).map((u) => u.id), ...headIds]);
      if (memberIds.size === 0) continue;

      let channel = byDept.get(dept.id);
      if (!channel) {
        const created = await prisma.chatChannel.create({
          data: { orgId, type: "group", name: dept.name, departmentId: dept.id, createdById: actorId },
          select: { id: true, name: true, departmentId: true, archived: true, members: { select: { userId: true, role: true } } },
        });
        channel = created;
      } else if (channel.name !== dept.name || channel.archived) {
        await prisma.chatChannel.update({ where: { id: channel.id }, data: { name: dept.name, archived: false } });
        changed.push(channel.id);
      }

      const current = new Map(channel.members.map((m) => [m.userId, m.role]));
      const toAdd = [...memberIds].filter((id) => !current.has(id));
      const toRemove = [...current.keys()].filter((id) => !memberIds.has(id));
      const toRole = [...memberIds].filter((id) => current.has(id) && (current.get(id) === "admin") !== headIds.has(id));

      if (toAdd.length > 0) {
        await prisma.chatChannelMember.createMany({
          data: toAdd.map((userId) => ({ channelId: channel!.id, userId, orgId, role: headIds.has(userId) ? "admin" : "member" })),
          skipDuplicates: true,
        });
      }
      if (toRemove.length > 0) {
        await prisma.chatChannelMember.deleteMany({ where: { orgId, channelId: channel.id, userId: { in: toRemove } } });
      }
      for (const userId of toRole) {
        await prisma.chatChannelMember.update({
          where: { channelId_userId: { channelId: channel.id, userId } },
          data: { role: headIds.has(userId) ? "admin" : "member" },
        });
      }
      if (toAdd.length || toRemove.length || toRole.length || !byDept.has(dept.id)) {
        changed.push(channel.id);
        publishToUsers([...toAdd, ...toRemove], { type: "chat.channel", channelId: channel.id });
      }
    }

    for (const c of channels) {
      if (!c.archived && !deptIds.has(c.departmentId!)) {
        await prisma.chatChannel.update({ where: { id: c.id }, data: { archived: true } });
        publishToUsers(c.members.map((m) => m.userId), { type: "chat.channel", channelId: c.id });
      }
    }
    for (const id of new Set(changed)) {
      publishToUsers(await channelMemberIds(orgId, id), { type: "chat.channel", channelId: id });
    }
  } catch (err) {
    // ซิงก์พลาดไม่ควรทำให้เปิดแชทไม่ได้ — ลองใหม่รอบหน้า
    cache.delete(orgId);
    console.error("[chat] department sync failed", err);
  }
}

// ─── รายการห้อง ───────────────────────────────────────────────────────────

export async function listChannelsForUser(orgId: string, userId: string): Promise<ChatChannelSummary[]> {
  const orgChanId = await ensureOrgChannel(orgId, userId);
  await syncDepartmentChannels(orgId, userId);

  const memberships = await prisma.chatChannelMember.findMany({
    where: { orgId, userId, channel: { archived: false } },
    select: { channelId: true },
  });
  const channelIds = [orgChanId, ...memberships.map((m) => m.channelId)];

  const [channels, allMembers, readStates] = await Promise.all([
    prisma.chatChannel.findMany({
      where: { orgId, id: { in: channelIds }, archived: false },
      select: { id: true, type: true, name: true, departmentId: true, createdAt: true },
    }),
    prisma.chatChannelMember.findMany({
      where: { orgId, channelId: { in: channelIds } },
      select: { channelId: true, userId: true },
    }),
    prisma.chatReadState.findMany({
      where: { orgId, userId, channelId: { in: channelIds } },
      select: { channelId: true, lastReadSeq: true, pinned: true, muted: true },
    }),
  ]);

  const readByChannel = new Map(readStates.map((r) => [r.channelId, r]));

  // ข้อความล่าสุดต่อห้อง — DISTINCT ON ใช้ index (channel_id, seq) ได้ตรง ๆ
  const lastMessages =
    channelIds.length > 0
      ? await prisma.$queryRaw<
          { id: string; channel_id: string; author_id: string; kind: string; body: string | null; attachments: unknown; deleted_at: Date | null; created_at: Date }[]
        >`
          SELECT DISTINCT ON (channel_id) id, channel_id, author_id, kind, body, attachments, deleted_at, created_at
          FROM chat.messages
          WHERE org_id = ${orgId} AND channel_id = ANY(${channelIds})
          ORDER BY channel_id, seq DESC`
      : [];
  const lastByChannel = new Map(lastMessages.map((m) => [m.channel_id, m]));

  // นับยังไม่อ่าน + ถูกแท็ก ด้วย query เดียวทุกห้อง (นับ ไม่ดึงแถวมาทั้งหมด)
  const unreadRows =
    channelIds.length > 0
      ? await prisma.$queryRaw<{ channel_id: string; unread: bigint; mentions: bigint }[]>`
          SELECT m.channel_id,
                 COUNT(*) AS unread,
                 COUNT(*) FILTER (WHERE m.mentions && ARRAY[${userId}, 'all']::text[]) AS mentions
          FROM chat.messages m
          LEFT JOIN chat.read_states r
            ON r.channel_id = m.channel_id AND r.user_id = ${userId}
          WHERE m.org_id = ${orgId}
            AND m.channel_id = ANY(${channelIds})
            AND m.deleted_at IS NULL
            AND m.kind = 'text'
            AND m.author_id <> ${userId}
            AND (r.last_read_seq IS NULL OR m.seq > r.last_read_seq)
          GROUP BY m.channel_id`
      : [];
  const unreadByChannel = new Map(unreadRows.map((r) => [r.channel_id, r]));

  const membersByChannel = new Map<string, string[]>();
  for (const m of allMembers) {
    const list = membersByChannel.get(m.channelId) ?? [];
    list.push(m.userId);
    membersByChannel.set(m.channelId, list);
  }

  const summaries: ChatChannelSummary[] = channels.map((c) => {
    const last = lastByChannel.get(c.id);
    const read = readByChannel.get(c.id);
    const unread = unreadByChannel.get(c.id);
    return {
      id: c.id,
      type: c.type,
      name: c.name,
      departmentId: c.departmentId,
      memberIds: membersByChannel.get(c.id) ?? [],
      unreadCount: Number(unread?.unread ?? 0),
      mentionCount: Number(unread?.mentions ?? 0),
      pinned: read?.pinned ?? false,
      muted: read?.muted ?? false,
      lastMessage: last
        ? {
            id: last.id,
            body: last.deleted_at ? null : last.body,
            authorId: last.author_id,
            kind: last.kind,
            attachmentKind: last.deleted_at ? null : firstAttachmentKind(last.attachments),
            deleted: Boolean(last.deleted_at),
            createdAt: last.created_at.toISOString(),
          }
        : null,
      activityAt: (last?.created_at ?? c.createdAt).toISOString(),
    };
  });

  summaries.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.activityAt.localeCompare(a.activityAt);
  });
  return summaries;
}

export async function getChannelDetail(actor: ChatActor, channelId: string): Promise<ChatChannelDetail> {
  const access = await getChannelAccess(actor, channelId);
  const [channel, members, reads] = await Promise.all([
    prisma.chatChannel.findFirst({
      where: { id: channelId, orgId: actor.orgId },
      select: { id: true, type: true, name: true, departmentId: true, announcementId: true },
    }),
    access.type === "org"
      ? Promise.resolve([])
      : prisma.chatChannelMember.findMany({
          where: { orgId: actor.orgId, channelId },
          select: { userId: true, role: true },
          orderBy: { joinedAt: "asc" },
        }),
    // ห้องรวมทั้งบริษัทไม่แสดง "อ่านแล้ว N" (คนเป็นพัน ไม่มีประโยชน์และหนัก) เหมือน OpenChat ของ LINE
    access.type === "org"
      ? Promise.resolve([])
      : prisma.chatReadState.findMany({
          where: { orgId: actor.orgId, channelId, lastReadSeq: { not: null } },
          select: { userId: true, lastReadSeq: true },
        }),
  ]);
  if (!channel) throw new ChatError("ไม่พบห้องนี้", 404);

  let announcement = null;
  if (channel.announcementId) {
    const row = await prisma.chatMessage.findFirst({
      where: { id: channel.announcementId, orgId: actor.orgId, channelId, deletedAt: null },
    });
    if (row) [announcement] = await hydrateMessages(actor.orgId, [row]);
  }

  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    departmentId: channel.departmentId,
    members: members.map((m) => ({ userId: m.userId, role: m.role === "admin" ? "admin" : "member" })),
    readSeqs: Object.fromEntries(reads.map((r) => [r.userId, r.lastReadSeq!.toString()])),
    announcement: announcement ?? null,
    canManage: access.canManage,
  };
}

// ─── สร้างห้อง ────────────────────────────────────────────────────────────

/** หา DM ที่มีอยู่แล้วระหว่างสองคนนี้ ถ้ามีคืนห้องเดิม ไม่สร้างซ้ำ */
export async function getOrCreateDm(orgId: string, userAId: string, userBId: string): Promise<string> {
  if (userAId === userBId) throw new ChatError("แชทกับตัวเองไม่ได้", 400);
  // อีกฝั่งต้องเป็นพนักงาน active ของบริษัทเดียวกันเท่านั้น
  const [valid] = await activeOrgUserIds(orgId, [userBId]);
  if (!valid) throw new ChatError("ไม่พบผู้ใช้นี้ในบริษัท", 404);

  const existing = await prisma.chatChannel.findFirst({
    where: {
      orgId,
      type: "dm",
      members: { some: { userId: userAId } },
      AND: { members: { some: { userId: userBId } } },
    },
    select: { id: true, archived: true },
  });
  if (existing) {
    if (existing.archived) await prisma.chatChannel.update({ where: { id: existing.id }, data: { archived: false } });
    return existing.id;
  }

  const created = await prisma.chatChannel.create({
    data: {
      orgId,
      type: "dm",
      createdById: userAId,
      members: { create: [{ userId: userAId, orgId }, { userId: userBId, orgId }] },
    },
  });
  publishToUsers([userAId, userBId], { type: "chat.channel", channelId: created.id });
  return created.id;
}

export async function createGroup(orgId: string, callerId: string, name: string, memberIds: string[]): Promise<string> {
  const valid = await activeOrgUserIds(orgId, memberIds.filter((id) => id !== callerId));
  const allIds = Array.from(new Set([callerId, ...valid]));
  if (allIds.length < 2) throw new ChatError("เลือกสมาชิกกลุ่มอย่างน้อย 1 คน", 400);
  if (allIds.length > MAX_GROUP_MEMBERS) throw new ChatError(`กลุ่มมีสมาชิกได้ไม่เกิน ${MAX_GROUP_MEMBERS} คน`, 400);

  const created = await prisma.chatChannel.create({
    data: {
      orgId,
      type: "group",
      name: name.trim().slice(0, 100) || "กลุ่มไม่มีชื่อ",
      createdById: callerId,
      members: { create: allIds.map((userId) => ({ userId, orgId, role: userId === callerId ? "admin" : "member" })) },
    },
  });
  const names = await userNames([callerId]);
  await postSystemMessage(orgId, created.id, callerId, `${names.get(callerId) ?? "ผู้ใช้"} สร้างกลุ่ม "${created.name}"`);
  publishToUsers(allIds, { type: "chat.channel", channelId: created.id });
  return created.id;
}

// ─── จัดการห้อง ───────────────────────────────────────────────────────────

function requireManage(access: ChannelAccess) {
  if (!access.canManage) throw new ChatError("เฉพาะแอดมินของห้องเท่านั้น", 403);
}

function requireEditableMembers(access: ChannelAccess) {
  if (access.type !== "group") throw new ChatError("ห้องนี้เพิ่มหรือลบสมาชิกไม่ได้", 400);
  if (access.departmentId) throw new ChatError("กลุ่มประจำแผนกซิงก์สมาชิกตามแผนกอัตโนมัติ — แก้ที่ข้อมูลพนักงานแทน", 400);
}

export async function renameChannel(actor: ChatActor, channelId: string, name: string): Promise<void> {
  const access = await getChannelAccess(actor, channelId);
  requireManage(access);
  if (access.type !== "group" || access.departmentId) throw new ChatError("เปลี่ยนชื่อห้องนี้ไม่ได้", 400);
  const clean = name.trim().slice(0, 100);
  if (!clean) throw new ChatError("ตั้งชื่อกลุ่มก่อน", 400);
  await prisma.chatChannel.update({ where: { id: channelId }, data: { name: clean } });
  const names = await userNames([actor.userId]);
  await postSystemMessage(actor.orgId, channelId, actor.userId, `${names.get(actor.userId) ?? "ผู้ใช้"} เปลี่ยนชื่อกลุ่มเป็น "${clean}"`);
  await broadcastToChannel(actor.orgId, channelId, { type: "chat.channel", channelId });
}

export async function addMembers(actor: ChatActor, channelId: string, userIds: string[]): Promise<void> {
  const access = await getChannelAccess(actor, channelId);
  requireManage(access);
  requireEditableMembers(access);
  const existing = new Set(await channelMemberIds(actor.orgId, channelId));
  const toAdd = (await activeOrgUserIds(actor.orgId, userIds)).filter((id) => !existing.has(id));
  if (toAdd.length === 0) return;
  if (existing.size + toAdd.length > MAX_GROUP_MEMBERS) throw new ChatError(`กลุ่มมีสมาชิกได้ไม่เกิน ${MAX_GROUP_MEMBERS} คน`, 400);

  await prisma.chatChannelMember.createMany({
    data: toAdd.map((userId) => ({ channelId, userId, orgId: actor.orgId })),
    skipDuplicates: true,
  });
  const names = await userNames([actor.userId, ...toAdd]);
  const added = toAdd.map((id) => names.get(id) ?? "ผู้ใช้").join(", ");
  await postSystemMessage(actor.orgId, channelId, actor.userId, `${names.get(actor.userId) ?? "ผู้ใช้"} เพิ่ม ${added} เข้ากลุ่ม`);
  await broadcastToChannel(actor.orgId, channelId, { type: "chat.channel", channelId });
}

/** ลบสมาชิก (แอดมิน) หรือออกจากกลุ่มเอง (userId = ตัวเอง) */
export async function removeMember(actor: ChatActor, channelId: string, userId: string): Promise<void> {
  const access = await getChannelAccess(actor, channelId);
  const leaving = userId === actor.userId;
  if (!leaving) requireManage(access);
  requireEditableMembers(access);

  const members = await prisma.chatChannelMember.findMany({ where: { orgId: actor.orgId, channelId }, select: { userId: true, role: true } });
  if (!members.some((m) => m.userId === userId)) return;

  const before = members.map((m) => m.userId);
  await prisma.chatChannelMember.delete({ where: { channelId_userId: { channelId, userId } } });

  // แอดมินคนสุดท้ายออก → ยกคนที่อยู่นานสุดขึ้นเป็นแอดมินแทน กลุ่มจะได้ไม่ไร้คนดูแล
  const rest = members.filter((m) => m.userId !== userId);
  if (rest.length > 0 && !rest.some((m) => m.role === "admin")) {
    const next = await prisma.chatChannelMember.findFirst({ where: { orgId: actor.orgId, channelId }, orderBy: { joinedAt: "asc" } });
    if (next) await prisma.chatChannelMember.update({ where: { channelId_userId: { channelId, userId: next.userId } }, data: { role: "admin" } });
  }

  const names = await userNames([actor.userId, userId]);
  const text = leaving
    ? `${names.get(userId) ?? "ผู้ใช้"} ออกจากกลุ่ม`
    : `${names.get(actor.userId) ?? "ผู้ใช้"} นำ ${names.get(userId) ?? "ผู้ใช้"} ออกจากกลุ่ม`;
  await postSystemMessage(actor.orgId, channelId, actor.userId, text);
  publishToUsers(before, { type: "chat.channel", channelId });
}

export async function setMemberRole(actor: ChatActor, channelId: string, userId: string, role: "admin" | "member"): Promise<void> {
  const access = await getChannelAccess(actor, channelId);
  requireManage(access);
  requireEditableMembers(access);
  await prisma.chatChannelMember.updateMany({ where: { orgId: actor.orgId, channelId, userId }, data: { role } });
  await broadcastToChannel(actor.orgId, channelId, { type: "chat.channel", channelId });
}

/** ปักข้อความเป็นประกาศบนหัวห้อง (null = เอาออก) */
export async function setAnnouncement(actor: ChatActor, channelId: string, messageId: string | null): Promise<void> {
  const access = await getChannelAccess(actor, channelId);
  // DM ปักได้ทั้งสองคน, ห้องอื่นเฉพาะแอดมิน
  if (access.type !== "dm") requireManage(access);
  if (messageId) {
    const msg = await prisma.chatMessage.findFirst({
      where: { id: messageId, orgId: actor.orgId, channelId, deletedAt: null, kind: "text" },
      select: { id: true },
    });
    if (!msg) throw new ChatError("ไม่พบข้อความนี้", 404);
  }
  await prisma.chatChannel.update({ where: { id: channelId }, data: { announcementId: messageId } });
  await broadcastToChannel(actor.orgId, channelId, { type: "chat.channel", channelId });
}

/** ปักหมุด/ปิดเสียงห้อง — ตั้งค่าส่วนตัว ไม่กระทบคนอื่น */
export async function setChannelPrefs(actor: ChatActor, channelId: string, prefs: { pinned?: boolean; muted?: boolean }): Promise<void> {
  await getChannelAccess(actor, channelId);
  await prisma.chatReadState.upsert({
    where: { channelId_userId: { channelId, userId: actor.userId } },
    update: prefs,
    create: { channelId, userId: actor.userId, orgId: actor.orgId, ...prefs },
  });
  publishToUsers([actor.userId], { type: "chat.channel", channelId });
}

/** อ่านถึงข้อความล่าสุดของห้อง — คืน seq ที่อ่านถึง (null = ห้องว่าง) */
export async function markChannelRead(actor: ChatActor, channelId: string): Promise<string | null> {
  const access = await getChannelAccess(actor, channelId);
  const latest = await prisma.chatMessage.findFirst({
    where: { orgId: actor.orgId, channelId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  const current = await prisma.chatReadState.findUnique({
    where: { channelId_userId: { channelId, userId: actor.userId } },
    select: { lastReadSeq: true },
  });
  // ไม่ส่งซ้ำถ้าอ่านถึงตรงนี้อยู่แล้ว — เปิดห้องค้างไว้แล้วสลับแท็บไปมาไม่ควรยิงเหตุการณ์ถี่ ๆ
  if (latest && current?.lastReadSeq != null && current.lastReadSeq >= latest.seq) return current.lastReadSeq.toString();

  await prisma.chatReadState.upsert({
    where: { channelId_userId: { channelId, userId: actor.userId } },
    update: { lastReadSeq: latest?.seq, lastReadAt: new Date() },
    create: { channelId, userId: actor.userId, orgId: actor.orgId, lastReadSeq: latest?.seq, lastReadAt: new Date() },
  });
  if (latest) {
    const event = { type: "chat.read" as const, channelId, userId: actor.userId, lastReadSeq: latest.seq.toString() };
    // ห้อง org: ส่งแค่ถึงเครื่องอื่นของเจ้าตัว (ล้างตัวเลข) ไม่กระจายทั้งบริษัททุกครั้งที่มีคนเปิดอ่าน
    if (access.type === "org") publishToUsers([actor.userId], event);
    else await broadcastToChannel(actor.orgId, channelId, event);
  }
  return latest?.seq.toString() ?? null;
}

/** รายชื่อพนักงานในบริษัท (พร้อมแผนก) สำหรับเริ่มแชท / เพิ่มสมาชิก / @แท็ก */
export async function listOrgUsersForPicker(orgId: string) {
  const rows = await prisma.user.findMany({
    where: { orgId, isActive: true },
    select: { id: true, name: true, avatarUrl: true, departmentId: true, department: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    avatarUrl: u.avatarUrl,
    departmentId: u.departmentId,
    departmentName: u.department?.name ?? null,
  }));
}
