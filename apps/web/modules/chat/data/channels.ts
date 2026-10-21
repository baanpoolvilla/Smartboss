import "server-only";
import { WORKER_ROLE_CODE } from "@/modules/daily_worker/permissions";
import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { isWorkerUser } from "@/lib/worker-role";
import { prisma } from "@smartboss/database";

import { publishToOrg, publishToUsers } from "@/lib/realtime/server";
import { sendWebPush } from "@/lib/web-push";
import { notifyUsers } from "@/modules/maintenance/data/notify";
import { CHAT_ORG_CHANNEL_NAME } from "../constants";
import { CLOCK_CHANNEL_PREFIX, isKeepChannelId, type ChatChannelDetail, type ChatChannelSummary, type ChatRealtimeEvent } from "../types";
import { ensureKeepChannel } from "./keep";
import { closedChannels, forgetProjectRooms, isChannelClosed, projectRoomOf, writeChannelClosed } from "./project-room";
import { ChatError, firstAttachmentKind, hydrateMessages, type ChatActor } from "./serialize";
import { CHAT_PAGE_PATH } from "../constants";

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
    // คนงาน (บทบาท WORKER) ไม่อยู่ในห้องรวมทั้งบริษัท — คนอื่นเข้าได้ตามเดิม
    if (await isWorkerUser(actor.userId)) throw new ChatError("ไม่มีสิทธิ์เข้าห้องนี้", 403);
    await ensureOrgChannel(actor.orgId, actor.userId);
    // ชื่อจริงจาก DB — ห้องรวมทั้งบริษัทเปลี่ยนชื่อได้ (renameChannel) ค่าเริ่มต้นยังเป็น CHAT_ORG_CHANNEL_NAME
    const row = await prisma.chatChannel.findUnique({ where: { id: channelId }, select: { name: true } });
    return { id: channelId, type: "org", name: row?.name ?? CHAT_ORG_CHANNEL_NAME, departmentId: null, role: "member", canManage: actor.isChatAdmin };
  }
  const channel = await prisma.chatChannel.findFirst({
    where: { id: channelId, orgId: actor.orgId, archived: false },
    select: { id: true, type: true, name: true, departmentId: true, members: { where: { userId: actor.userId }, select: { role: true } } },
  });
  const member = channel?.members[0];
  if (!channel || !member) throw new ChatError("ไม่มีสิทธิ์เข้าห้องนี้", 403);
  const role = member.role === "admin" ? "admin" : "member";
  let canManage = channel.type !== "dm" && (role === "admin" || actor.isChatAdmin);
  // ห้องของโปรเจกต์: ผู้ดูแลโปรเจกต์ + สมาชิก "แก้ได้" จัดการห้องได้เหมือนแอดมินห้อง ไม่ว่าใครกดสร้าง (ผู้ใช้ 20/10/2569)
  if (!canManage && channel.type === "group") {
    canManage = (await projectRoomOf(actor.orgId, channel.id))?.managerIds.has(actor.userId) ?? false;
  }
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    departmentId: channel.departmentId,
    role,
    canManage,
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

async function userNames(orgId: string, ids: string[]): Promise<Map<string, string>> {
  const rows = await prisma.user.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } });
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
    const renamed = new Set((await readStore<string[]>(orgId, RENAMED_KEY)).data ?? []);
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
      } else if ((channel.name !== dept.name && !renamed.has(channel.id)) || channel.archived) {
        // ตั้งชื่อกลุ่มเองแล้ว (renameChannel) = ไม่เขียนชื่อแผนกทับ
        await prisma.chatChannel.update({ where: { id: channel.id }, data: { ...(renamed.has(channel.id) ? {} : { name: dept.name }), archived: false } });
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

// ─── ทีมหน้างาน (ห้องรวมพนักงานและคนงาน) ─────────────────────────────────────────────

/** ห้องรวมพนักงานและคนงาน — id คงที่ต่อบริษัท · สมาชิกเพิ่มเอง + แก้เองได้แบบกลุ่ม LINE */
export const WORKER_CHANNEL_PREFIX = "workers-";
export function workerChannelId(orgId: string): string {
  return `${WORKER_CHANNEL_PREFIX}${orgId}`;
}
const WORKER_CHANNEL_NAME = "ทีมหน้างาน";
/** ชื่อเริ่มต้นของรุ่นก่อน — เปลี่ยนเป็นชื่อปัจจุบันให้ครั้งเดียว · ชื่อที่ตั้งเองไม่แตะ */
const OLD_WORKER_CHANNEL_NAMES = new Set(["ห้องรวมคนงาน", "ห้องรวมพนักงานและคนงาน"]);
/** คนที่ถูกเอาออก/ออกเอง — ระบบไม่เพิ่มกลับให้อีก (store ของบริษัท) · เพิ่มกลับด้วยมือ = ลบออกจากรายการนี้ */
const WORKER_ROOM_EXCLUDED_KEY = "chat-worker-room-excluded";
const gw = globalThis as unknown as { __chatWorkerSyncAt?: Map<string, number> };

async function readExcluded(orgId: string): Promise<{ list: string[]; version: number }> {
  const { data, version } = await readStore<string[]>(orgId, WORKER_ROOM_EXCLUDED_KEY);
  return { list: data ?? [], version };
}
async function changeExcluded(orgId: string, actorId: string, change: (list: Set<string>) => void): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, version } = await readStore<string[]>(orgId, WORKER_ROOM_EXCLUDED_KEY);
    const set = new Set(data ?? []);
    change(set);
    const r = await writeStore(orgId, WORKER_ROOM_EXCLUDED_KEY, [...set], data === null ? null : version, actorId);
    if (r.ok) return;
  }
}

/**
 * ห้องรวมพนักงานและคนงาน — คนงาน (WORKER) ไม่อยู่ในห้องรวมทั้งบริษัท ห้องนี้จึงรวมทุกคนไว้ด้วยกัน
 * สมาชิก = ผู้ใช้ที่ active ทุกคน (พนักงาน + คนงาน) ยกเว้นคนที่ถูกเอาออก/ออกเอง (ไม่เพิ่มกลับให้)
 * คนใหม่ = เข้าห้องเอง · ปิดบัญชี = ออกเอง · แอดมินห้อง = CEO / ผู้ดูแลระบบสูงสุด (เพิ่ม/เอาออก/ตั้งแอดมินได้แบบกลุ่ม LINE)
 * ยังไม่มีคนงานเลย = ยังไม่สร้างห้อง · ทำจริงไม่เกินนาทีละครั้งต่อบริษัทต่อโปรเซส
 */
export async function syncWorkerChannel(orgId: string, actorId: string, force = false): Promise<void> {
  const cache = (gw.__chatWorkerSyncAt ??= new Map());
  const last = cache.get(orgId) ?? 0;
  if (!force && Date.now() - last < DEPT_SYNC_INTERVAL_MS) return;
  cache.set(orgId, Date.now());
  try {
    const id = workerChannelId(orgId);
    const [users, channel, excluded] = await Promise.all([
      prisma.user.findMany({ where: { orgId, isActive: true }, select: { id: true, roles: { select: { role: { select: { code: true } } } } } }),
      prisma.chatChannel.findFirst({ where: { id, orgId }, select: { id: true, name: true, archived: true, members: { select: { userId: true, role: true } } } }),
      readExcluded(orgId),
    ]);
    const hasWorker = users.some((u) => u.roles.some((r) => r.role.code === WORKER_ROLE_CODE));
    if (!hasWorker && !channel) return;
    const out = new Set(excluded.list);
    const adminIds = new Set(users.filter((u) => u.roles.some((r) => r.role.code === "CEO" || r.role.code === "SUPER_ADMIN")).map((u) => u.id));
    const memberIds = new Set(users.map((u) => u.id).filter((u) => !out.has(u)));
    if (!channel) {
      await prisma.chatChannel.create({ data: { id, orgId, type: "group", name: WORKER_CHANNEL_NAME, createdById: actorId } });
    } else if (channel.archived || OLD_WORKER_CHANNEL_NAMES.has(channel.name ?? "")) {
      await prisma.chatChannel.update({
        where: { id },
        data: { archived: false, ...(OLD_WORKER_CHANNEL_NAMES.has(channel.name ?? "") ? { name: WORKER_CHANNEL_NAME } : {}) },
      });
    }
    const current = new Map((channel?.members ?? []).map((m) => [m.userId, m.role]));
    const activeIds = new Set(users.map((u) => u.id));
    const toAdd = [...memberIds].filter((u) => !current.has(u));
    // เอาออกเองเฉพาะคนที่ปิดบัญชีแล้ว — คนที่ถูกเอาออกด้วยมือหายไปจาก current อยู่แล้ว
    const toRemove = [...current.keys()].filter((u) => !activeIds.has(u));
    // CEO/ผู้ดูแลสูงสุดเป็นแอดมินเสมอ · คนที่ถูกตั้งเป็นแอดมินด้วยมือไม่ถูกปลด
    const toAdmin = [...adminIds].filter((u) => current.has(u) && current.get(u) !== "admin");
    if (toAdd.length > 0) {
      await prisma.chatChannelMember.createMany({
        data: toAdd.map((userId) => ({ channelId: id, userId, orgId, role: adminIds.has(userId) ? "admin" : "member" })),
        skipDuplicates: true,
      });
    }
    if (toRemove.length > 0) await prisma.chatChannelMember.deleteMany({ where: { orgId, channelId: id, userId: { in: toRemove } } });
    for (const userId of toAdmin) {
      await prisma.chatChannelMember.update({ where: { channelId_userId: { channelId: id, userId } }, data: { role: "admin" } });
    }
    if (toAdd.length || toRemove.length || toAdmin.length || !channel) {
      publishToUsers([...new Set([...memberIds, ...toRemove])], { type: "chat.channel", channelId: id });
    }
  } catch (err) {
    cache.delete(orgId);
    console.error("[chat] worker channel sync failed", err);
  }
}

// ─── รายการห้อง ───────────────────────────────────────────────────────────

export async function listChannelsForUser(orgId: string, userId: string): Promise<ChatChannelSummary[]> {
  const orgChanId = await ensureOrgChannel(orgId, userId);
  await syncDepartmentChannels(orgId, userId);
  await syncWorkerChannel(orgId, userId);
  // ห้อง Keep Memo ของตัวเอง (แชทกับตัวเอง แบบ LINE) — สร้างให้ครั้งแรกที่เปิดแชท
  await ensureKeepChannel(orgId, userId).catch((err) => console.error("[chat] ensure keep channel failed", err));

  const memberships = await prisma.chatChannelMember.findMany({
    where: { orgId, userId, channel: { archived: false } },
    select: { channelId: true },
  });
  // คนงาน (บทบาท WORKER) ไม่เห็นห้องรวมทั้งบริษัท — เห็นแค่แชทส่วนตัว/กลุ่มที่ถูกเพิ่ม
  const channelIds = [...((await isWorkerUser(userId)) ? [] : [orgChanId]), ...memberships.map((m) => m.channelId)];

  const [channels, allMembers, readStates] = await Promise.all([
    prisma.chatChannel.findMany({
      where: { orgId, id: { in: channelIds }, archived: false },
      select: { id: true, type: true, name: true, avatarUrl: true, departmentId: true, createdAt: true },
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
            -- ห้องระบบลงเวลา (clock-…) นับข้อความระบบด้วย — ดู countsAsUnread ใน ../types
            AND (m.kind IN ('text', 'note') OR (m.kind = 'system' AND m.channel_id LIKE 'clock-%'))
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

  const closedMap = await closedChannels(orgId);
  const summaries: ChatChannelSummary[] = channels.map((c) => {
    const last = lastByChannel.get(c.id);
    const read = readByChannel.get(c.id);
    const unread = unreadByChannel.get(c.id);
    return {
      id: c.id,
      type: c.type,
      name: c.name,
      avatarUrl: c.avatarUrl,
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
      ...(c.id in closedMap ? { closed: true } : {}),
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
      select: { id: true, type: true, name: true, avatarUrl: true, departmentId: true, announcementId: true, createdById: true },
    }),
    access.type === "org"
      ? Promise.resolve([])
      : prisma.chatChannelMember.findMany({
          where: { orgId: actor.orgId, channelId },
          select: { userId: true, role: true },
          orderBy: { joinedAt: "asc" },
        }),
    // ทุกห้อง รวมห้องรวมทั้งบริษัท แสดง "อ่านแล้ว N" แบบกลุ่ม LINE
    prisma.chatReadState.findMany({
      where: { orgId: actor.orgId, channelId, lastReadSeq: { not: null } },
      select: { userId: true, lastReadSeq: true },
    }),
  ]);
  if (!channel) throw new ChatError("ไม่พบห้องนี้", 404);
  const projectRoom = access.type === "group" ? await projectRoomOf(actor.orgId, channelId) : null;
  const closed = projectRoom ? await isChannelClosed(actor.orgId, channelId) : false;

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
    avatarUrl: channel.avatarUrl,
    departmentId: channel.departmentId,
    members: members.map((m) => ({ userId: m.userId, role: m.role === "admin" ? "admin" : "member" })),
    readSeqs: Object.fromEntries(reads.map((r) => [r.userId, r.lastReadSeq!.toString()])),
    announcement: announcement ?? null,
    canManage: access.canManage,
    canRename:
      canRename(
        actor,
        { id: channel.id, type: access.type, departmentId: channel.departmentId, createdById: access.type === "org" ? null : channel.createdById },
        access.role,
      ) || !!projectRoom?.managerIds.has(actor.userId),
    projectId: projectRoom?.projectId ?? null,
    closed,
    canClose: !!projectRoom && access.canManage,
    canDelete: !!projectRoom && (projectRoom.ownerId === actor.userId || !!actor.isTopAdmin || actor.isChatAdmin),
    canChangeAvatar: canChangeAvatar(actor, {
      id: channel.id,
      type: access.type,
      departmentId: channel.departmentId,
      // ห้องรวมทั้งบริษัทผูกกับบริษัท ไม่มีคนสร้างจริง — สิทธิ์ดูจากแอดมินแชทอย่างเดียว
      createdById: access.type === "org" ? null : channel.createdById,
    }),
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

/**
 * แจ้งคนที่ถูกเพิ่มเข้ากลุ่ม — ข้อความระบบ "สร้างกลุ่ม/เพิ่มเข้ากลุ่ม" ไม่เด้ง (notifyNewMessage
 * แจ้งเฉพาะข้อความที่คนพิมพ์) ⇒ เดิมคนที่ไม่ได้เปิดเว็บอยู่ไม่รู้เลยว่ามีกลุ่มใหม่จนกว่าจะเปิดแชทเอง
 * ลงกระดิ่ง (กดแล้วเปิดกลุ่ม) + เด้งเข้าเครื่องคนที่ไม่ได้ดูหน้าจอ · ไม่ throw
 */
async function notifyAddedToGroup(orgId: string, channelId: string, groupName: string, actorId: string, userIds: string[]) {
  const ids = userIds.filter((id) => id !== actorId);
  if (ids.length === 0) return;
  try {
    const actorName = (await userNames(orgId, [actorId])).get(actorId) ?? "เพื่อนร่วมงาน";
    const title = `${actorName} เพิ่มคุณเข้ากลุ่ม "${groupName}"`;
    await notifyUsers(orgId, ids, { title, type: "chat_message", referenceId: channelId });
    await sendWebPush(orgId, ids, { title, body: "แตะเพื่อเปิดกลุ่ม", url: `${CHAT_PAGE_PATH}?c=${encodeURIComponent(channelId)}`, tag: `chat-${channelId}` });
  } catch (err) {
    console.error("[chat] notify added-to-group failed", err);
  }
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
  const names = await userNames(orgId, [callerId]);
  await postSystemMessage(orgId, created.id, callerId, `${names.get(callerId) ?? "ผู้ใช้"} สร้างกลุ่ม "${created.name}"`);
  publishToUsers(allIds, { type: "chat.channel", channelId: created.id });
  await notifyAddedToGroup(orgId, created.id, created.name ?? "กลุ่ม", callerId, allIds);
  return created.id;
}

// ─── จัดการห้อง ───────────────────────────────────────────────────────────

function requireManage(access: ChannelAccess) {
  if (!access.canManage) throw new ChatError("เฉพาะแอดมินของห้องเท่านั้น", 403);
}

function requireEditableMembers(access: ChannelAccess) {
  if (access.type !== "group") throw new ChatError("ห้องนี้เพิ่มหรือลบสมาชิกไม่ได้", 400);
  // Keep Memo เป็นของคนเดียวเสมอ — เพิ่มคน/ออกจากห้องไม่ได้
  if (isKeepChannelId(access.id)) throw new ChatError("Keep Memo เป็นห้องส่วนตัว เพิ่มหรือเอาสมาชิกออกไม่ได้", 400);
  if (access.departmentId) throw new ChatError("กลุ่มประจำแผนกซิงก์สมาชิกตามแผนกอัตโนมัติ — แก้ที่ข้อมูลพนักงานแทน", 400);
}

/** ห้องที่ตั้งชื่อเองแล้ว (กลุ่มแผนก) — ซิงก์แผนกไม่เขียนชื่อแผนกทับ (store ของบริษัท) */
const RENAMED_KEY = "chat-renamed-channels";

/**
 * ใครเปลี่ยนชื่อห้องได้ — CEO / ผู้ดูแลระบบสูงสุด / ฝ่าย IT (ADMIN) / แอดมินแชท: ทุกห้อง · คนสร้างห้อง: ห้องของตัวเอง
 * แอดมินกลุ่ม: กลุ่มที่สร้างเอง (กติกาเดิม) · แชทส่วนตัว (DM) และห้อง "ระบบลงเวลา" ตั้งชื่อไม่ได้
 */
function canRename(actor: ChatActor, channel: { id: string; type: string; departmentId: string | null; createdById: string | null }, role: "admin" | "member"): boolean {
  if (channel.type === "dm" || channel.id.startsWith(CLOCK_CHANNEL_PREFIX) || isKeepChannelId(channel.id)) return false;
  if (actor.isTopAdmin || actor.isChatAdmin) return true;
  if (channel.type !== "org" && channel.createdById === actor.userId) return true;
  return channel.type === "group" && !channel.departmentId && role === "admin";
}

export async function renameChannel(actor: ChatActor, channelId: string, name: string): Promise<void> {
  const access = await getChannelAccess(actor, channelId);
  const row = await prisma.chatChannel.findFirst({ where: { id: channelId, orgId: actor.orgId }, select: { createdById: true } });
  if (
    !canRename(actor, { id: channelId, type: access.type, departmentId: access.departmentId, createdById: row?.createdById ?? null }, access.role) &&
    !(await projectRoomOf(actor.orgId, channelId))?.managerIds.has(actor.userId)
  ) {
    throw new ChatError("เปลี่ยนชื่อห้องนี้ไม่ได้", 403);
  }
  const clean = name.trim().slice(0, 100);
  if (!clean) throw new ChatError("ตั้งชื่อกลุ่มก่อน", 400);
  await prisma.chatChannel.update({ where: { id: channelId }, data: { name: clean } });
  // กลุ่มแผนก: จำไว้ว่าตั้งชื่อเองแล้ว ไม่ให้ซิงก์แผนกเขียนชื่อแผนกกลับ
  if (access.departmentId) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, version } = await readStore<string[]>(actor.orgId, RENAMED_KEY);
      const set = new Set(data ?? []);
      set.add(channelId);
      if ((await writeStore(actor.orgId, RENAMED_KEY, [...set], data === null ? null : version, actor.userId)).ok) break;
    }
  }
  const names = await userNames(actor.orgId, [actor.userId]);
  await postSystemMessage(actor.orgId, channelId, actor.userId, `${names.get(actor.userId) ?? "ผู้ใช้"} เปลี่ยนชื่อกลุ่มเป็น "${clean}"`);
  await broadcastToChannel(actor.orgId, channelId, { type: "chat.channel", channelId });
}

/**
 * ใครเปลี่ยนรูปห้องนี้ได้ — กลุ่มที่คนสร้างเอง: เฉพาะคนสร้าง · ห้องที่ระบบสร้างให้ (ห้องรวมทั้งบริษัท,
 * กลุ่มแผนก, ห้อง "ทีมหน้างาน"): แอดมินแชท + CEO/ADMIN ("เฉพาะคนสร้างเปลี่ยนได้ ถ้าเป็นที่ระบบสร้างให้ แอดมินเปลี่ยนได้")
 * ห้องทีมหน้างานถูกสร้างตอนมีคนเปิดครั้งแรก createdById จึงเป็นคนนั้น ไม่ใช่เจ้าของห้องจริง — เดิมเลยไม่มีแอดมินคนไหน
 * เปลี่ยนรูปได้เลย ("ทีมหน้างาน พี่เปลี่ยนรูปไม่ได้" 21/10/2569)
 * DM ใช้รูปของอีกฝั่ง · ห้อง "ระบบลงเวลา" ใช้รูปนาฬิกาของระบบเสมอ (channel-list.tsx) — ตั้งไม่ได้ทั้งคู่
 */
function canChangeAvatar(
  actor: ChatActor,
  channel: { id: string; type: string; departmentId: string | null; createdById: string | null }
): boolean {
  if (channel.type === "dm" || channel.id.startsWith(CLOCK_CHANNEL_PREFIX) || isKeepChannelId(channel.id)) return false;
  if (channel.type === "org" || channel.departmentId || channel.id.startsWith(WORKER_CHANNEL_PREFIX)) return actor.isChatAdmin || !!actor.isTopAdmin;
  return channel.createdById === actor.userId;
}

/**
 * ตั้ง/ลบรูปห้อง (ดู canChangeAvatar) — `url` = ไฟล์ที่อัปโหลดและตรวจแล้ว (route) · null = ลบรูป
 * กลับเป็นไอคอนเดิม · คืน URL เก่าให้ผู้เรียกลบไฟล์
 */
export async function setChannelAvatar(actor: ChatActor, channelId: string, url: string | null): Promise<string | null> {
  const access = await getChannelAccess(actor, channelId);
  const before = await prisma.chatChannel.findFirst({
    where: { id: channelId, orgId: actor.orgId },
    select: { avatarUrl: true, createdById: true },
  });
  if (!canChangeAvatar(actor, { id: channelId, type: access.type, departmentId: access.departmentId, createdById: before?.createdById ?? null })) {
    throw new ChatError(
      access.type === "group" && !access.departmentId && !channelId.startsWith(WORKER_CHANNEL_PREFIX) ? "เฉพาะคนสร้างกลุ่มเท่านั้นที่เปลี่ยนรูปได้" : "เฉพาะแอดมินเท่านั้นที่เปลี่ยนรูปห้องนี้ได้",
      403
    );
  }
  await prisma.chatChannel.update({ where: { id: channelId }, data: { avatarUrl: url } });
  const names = await userNames(actor.orgId, [actor.userId]);
  const who = names.get(actor.userId) ?? "ผู้ใช้";
  await postSystemMessage(actor.orgId, channelId, actor.userId, url ? `${who} เปลี่ยนรูปกลุ่ม` : `${who} ลบรูปกลุ่ม`);
  await broadcastToChannel(actor.orgId, channelId, { type: "chat.channel", channelId });
  return before?.avatarUrl ?? null;
}

export async function addMembers(actor: ChatActor, channelId: string, userIds: string[]): Promise<void> {
  const access = await getChannelAccess(actor, channelId);
  requireManage(access);
  requireEditableMembers(access);
  const existing = new Set(await channelMemberIds(actor.orgId, channelId));
  const toAdd = (await activeOrgUserIds(actor.orgId, userIds)).filter((id) => !existing.has(id));
  // ห้องรวมพนักงานและคนงาน: เพิ่มกลับด้วยมือ = ไม่อยู่ในรายชื่อที่ถูกเอาออกแล้ว
  if (channelId.startsWith(WORKER_CHANNEL_PREFIX) && toAdd.length > 0) {
    await changeExcluded(actor.orgId, actor.userId, (set) => toAdd.forEach((id) => set.delete(id)));
  }
  if (toAdd.length === 0) return;
  if (existing.size + toAdd.length > MAX_GROUP_MEMBERS) throw new ChatError(`กลุ่มมีสมาชิกได้ไม่เกิน ${MAX_GROUP_MEMBERS} คน`, 400);

  await prisma.chatChannelMember.createMany({
    data: toAdd.map((userId) => ({ channelId, userId, orgId: actor.orgId })),
    skipDuplicates: true,
  });
  const names = await userNames(actor.orgId, [actor.userId, ...toAdd]);
  const added = toAdd.map((id) => names.get(id) ?? "ผู้ใช้").join(", ");
  await postSystemMessage(actor.orgId, channelId, actor.userId, `${names.get(actor.userId) ?? "ผู้ใช้"} เพิ่ม ${added} เข้ากลุ่ม`);
  await broadcastToChannel(actor.orgId, channelId, { type: "chat.channel", channelId });
  const channel = await prisma.chatChannel.findFirst({ where: { id: channelId, orgId: actor.orgId }, select: { name: true } });
  await notifyAddedToGroup(actor.orgId, channelId, channel?.name ?? "กลุ่ม", actor.userId, toAdd);
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
  // ห้องรวมพนักงานและคนงาน: ถูกเอาออก/ออกเอง = ระบบไม่เพิ่มกลับให้อีก
  if (channelId.startsWith(WORKER_CHANNEL_PREFIX)) {
    await changeExcluded(actor.orgId, actor.userId, (set) => set.add(userId));
  }

  // แอดมินคนสุดท้ายออก → ยกคนที่อยู่นานสุดขึ้นเป็นแอดมินแทน กลุ่มจะได้ไม่ไร้คนดูแล
  const rest = members.filter((m) => m.userId !== userId);
  if (rest.length > 0 && !rest.some((m) => m.role === "admin")) {
    const next = await prisma.chatChannelMember.findFirst({ where: { orgId: actor.orgId, channelId }, orderBy: { joinedAt: "asc" } });
    if (next) await prisma.chatChannelMember.update({ where: { channelId_userId: { channelId, userId: next.userId } }, data: { role: "admin" } });
  }

  const names = await userNames(actor.orgId, [actor.userId, userId]);
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
      where: { id: messageId, orgId: actor.orgId, channelId, deletedAt: null, kind: { in: ["text", "note"] } },
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
    // ห้อง org ก็กระจายทั้งบริษัท — คนส่งเห็น "อ่านแล้ว N" ขึ้นสด ๆ
    await broadcastToChannel(actor.orgId, channelId, event);
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

// ─── ห้องของโปรเจกต์: ปิดเก็บ / ลบ (project-room.ts) ──────────────────────────

async function requireProjectRoom(actor: ChatActor, channelId: string) {
  const access = await getChannelAccess(actor, channelId);
  const room = access.type === "group" ? await projectRoomOf(actor.orgId, channelId) : null;
  if (!room) throw new ChatError("ปิด/ลบได้เฉพาะห้องแชทของโปรเจกต์", 400);
  return { access, room };
}

/** ปิดห้อง = อ่านย้อนหลังได้ ส่งข้อความใหม่ไม่ได้ · เปิดอีกครั้งได้ — ผู้ดูแลโปรเจกต์ / สมาชิก "แก้ได้" / แอดมินห้อง */
export async function setChannelClosed(actor: ChatActor, channelId: string, closed: boolean): Promise<void> {
  const { access } = await requireProjectRoom(actor, channelId);
  requireManage(access);
  if (!(await writeChannelClosed(actor.orgId, channelId, closed, actor.userId))) return;
  const names = await userNames(actor.orgId, [actor.userId]);
  const who = names.get(actor.userId) ?? "ผู้ใช้";
  await postSystemMessage(
    actor.orgId,
    channelId,
    actor.userId,
    closed ? `${who} ปิดห้องนี้แล้ว — อ่านย้อนหลังได้ ส่งข้อความใหม่ไม่ได้` : `${who} เปิดห้องนี้อีกครั้ง`,
  );
  await broadcastToChannel(actor.orgId, channelId, { type: "chat.channel", channelId });
}

/**
 * ลบห้องของโปรเจกต์ — ห้องหายจากทุกคน แต่เก็บเข้าคลัง (archived) ไม่ลบข้อความทิ้ง กู้คืนได้ด้วย SQL
 * สิทธิ์: ผู้ดูแลโปรเจกต์ / CEO · ผู้ดูแลระบบสูงสุด · IT / แอดมินแชท
 */
export async function deleteProjectChannel(actor: ChatActor, channelId: string): Promise<void> {
  const { room } = await requireProjectRoom(actor, channelId);
  if (room.ownerId !== actor.userId && !actor.isTopAdmin && !actor.isChatAdmin) {
    throw new ChatError("ลบห้องได้เฉพาะผู้ดูแลโปรเจกต์", 403);
  }
  const memberIds = await channelMemberIds(actor.orgId, channelId);
  await prisma.chatChannel.update({ where: { id: channelId }, data: { archived: true } });
  await writeChannelClosed(actor.orgId, channelId, false, actor.userId).catch(() => false);
  forgetProjectRooms(actor.orgId);
  publishToUsers(memberIds, { type: "chat.channel", channelId });
}
