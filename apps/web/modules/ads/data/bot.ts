import "server-only";
import { prisma, type Prisma } from "@smartboss/database";
import { sendWebPush } from "@/lib/web-push";
import { usersWithPermission } from "@/modules/maintenance/data/notify";
import { broadcastToChannel, channelMemberIds } from "@/modules/chat/data/channels";
import { hydrateMessages, type ChatActor } from "@/modules/chat/data/serialize";
import { CHAT_PAGE_PATH } from "@/modules/chat/constants";
import { ADS_BOT_AUTHOR, ADS_BOT_CHANNEL_PREFIX, ADS_BOT_NAME } from "@/modules/chat/types";
import { ADS_PERMS } from "../permissions";
import { sendAgentWebhook } from "./webhooks";

/**
 * กลุ่ม "🤖 Ads Agent" ในแชท Smartboss — กลุ่มรวมห้องเดียวต่อบริษัท (ผู้ใช้ 17/11/2569)
 *
 *  - id = adsbot-<orgId> · สมาชิกกลุ่ม = คนที่กดอนุมัติคำขอปรับได้ทั้งหมด (ไม่ต้องมีสิทธิ์พิเศษ)
 *    เพิ่ม/ลบคนด้วยเมนูสมาชิกของแชทตามปกติ (แอดมินกลุ่ม) · สร้างครั้งแรกใส่ผู้ดูแลโมดูล (ads.admin) เป็นแอดมินกลุ่ม
 *  - ข้อความของบอท kind "bot" · การ์ดคำขอปรับ kind "ads_proposal" (meta.proposalId) — การ์ดใบเดียวในกลุ่ม
 *    ทุกคนเห็นใบเดียวกัน คนแรกที่กดชนะ (สถานะจริงอยู่ที่ ads_change_proposals · เปลี่ยนเมื่อไหร่ส่งการ์ดใหม่ id เดิม)
 *  - สมาชิกพิมพ์ในกลุ่ม → webhook bot.message ให้ n8n · n8n ตอบกลับเข้ากลุ่มผ่าน POST /api/agent/ads/messages
 */

export function botChannelId(orgId: string): string {
  return `${ADS_BOT_CHANNEL_PREFIX}${orgId}`;
}

const ensured = new Set<string>();

/** สร้างกลุ่มถ้ายังไม่มี — ครั้งแรกใส่ผู้ดูแลโมดูล Google Ads เป็นแอดมินกลุ่ม (เพิ่มคนอื่นต่อเองในแชท) */
export async function ensureBotGroup(orgId: string): Promise<string> {
  const id = botChannelId(orgId);
  if (ensured.has(id)) return id;
  const existing = await prisma.chatChannel.findFirst({ where: { id, orgId }, select: { id: true, archived: true } });
  if (!existing) {
    const admins = await usersWithPermission(orgId, ADS_PERMS.admin);
    await prisma.chatChannel.create({ data: { id, orgId, type: "group", name: ADS_BOT_NAME, createdById: admins[0] ?? ADS_BOT_AUTHOR } });
    if (admins.length > 0) {
      await prisma.chatChannelMember.createMany({ data: admins.map((userId) => ({ channelId: id, userId, orgId, role: "admin" })), skipDuplicates: true });
    }
  } else if (existing.archived) {
    await prisma.chatChannel.update({ where: { id }, data: { archived: false } });
  }
  ensured.add(id);
  return id;
}

/** คนที่กดอนุมัติได้ = สมาชิกกลุ่ม Ads Agent ที่ยังทำงานอยู่ */
export async function approverIds(orgId: string): Promise<string[]> {
  const channelId = await ensureBotGroup(orgId);
  const ids = await channelMemberIds(orgId, channelId);
  if (ids.length === 0) return [];
  const active = await prisma.user.findMany({ where: { orgId, id: { in: ids }, isActive: true }, select: { id: true } });
  return active.map((u) => u.id);
}

async function post(
  orgId: string,
  data: { kind: "bot" | "ads_proposal"; body: string; meta?: Prisma.InputJsonValue; replyToId?: string | null; mentions?: string[] }
): Promise<{ messageId: string; members: number }> {
  const channelId = await ensureBotGroup(orgId);
  const members = await channelMemberIds(orgId, channelId);
  const row = await prisma.chatMessage.create({
    data: {
      orgId,
      channelId,
      authorId: ADS_BOT_AUTHOR,
      kind: data.kind,
      body: data.body,
      meta: data.meta,
      replyToId: data.replyToId ?? null,
      mentions: data.mentions ?? [],
    },
  });
  const [message] = await hydrateMessages(orgId, [row]);
  await broadcastToChannel(
    orgId,
    channelId,
    { type: "chat.message", channelId, message: message!, authorName: "Ads Agent", channelName: ADS_BOT_NAME, channelType: "group" },
    members
  );
  await pushToMembers(orgId, channelId, members, data.body, data.mentions ?? []);
  return { messageId: row.id, members: members.length };
}

/** เด้งเข้ามือถือ/เครื่องที่ไม่ได้ดูจอ — เว้นคนที่ปิดเสียงกลุ่มไว้ (ยกเว้นถูกแท็ก) */
async function pushToMembers(orgId: string, channelId: string, members: string[], body: string, mentions: string[]): Promise<void> {
  try {
    if (members.length === 0) return;
    const muted = new Set(
      (await prisma.chatReadState.findMany({ where: { orgId, channelId, userId: { in: members }, muted: true }, select: { userId: true } })).map((m) => m.userId)
    );
    const targets = members.filter((id) => !muted.has(id) || mentions.includes(id));
    if (targets.length === 0) return;
    await sendWebPush(orgId, targets, {
      title: ADS_BOT_NAME,
      body: body.slice(0, 140),
      url: `${CHAT_PAGE_PATH}?c=${encodeURIComponent(channelId)}`,
      tag: `chat-${channelId}`,
    });
  } catch (err) {
    console.error("[ads-bot] push ไม่สำเร็จ:", err);
  }
}

/** ข้อความของบอทเข้ากลุ่ม · แท็กได้เฉพาะสมาชิกกลุ่ม · ตอบกลับได้เฉพาะข้อความในกลุ่มนี้ */
export async function postBotText(
  orgId: string,
  text: string,
  opts: { replyToId?: string | null; mentionUserIds?: string[] } = {}
): Promise<{ message_id: string; members: number }> {
  const body = text.trim().slice(0, 4000);
  if (!body) throw new Error("ข้อความว่าง");
  const channelId = await ensureBotGroup(orgId);
  const reply = opts.replyToId
    ? await prisma.chatMessage.findFirst({ where: { orgId, id: opts.replyToId, channelId }, select: { id: true } })
    : null;
  const members = new Set(await channelMemberIds(orgId, channelId));
  const mentions = (opts.mentionUserIds ?? []).filter((id) => members.has(id));
  const r = await post(orgId, { kind: "bot", body, replyToId: reply?.id ?? null, mentions });
  return { message_id: r.messageId, members: r.members };
}

/** การ์ดคำขอปรับใบเดียวเข้ากลุ่ม */
export async function postProposalCard(orgId: string, proposalId: string, headline: string, mentionUserIds: string[] = []): Promise<number> {
  return (await post(orgId, { kind: "ads_proposal", body: headline, meta: { proposalId }, mentions: mentionUserIds })).members;
}

/** สถานะคำขอเปลี่ยน → ส่งการ์ดเวอร์ชันใหม่ (id เดิม) ให้ทุกคนในกลุ่ม — ปุ่มหายจากทุกคนพร้อมกัน */
export async function refreshProposalCards(orgId: string, proposalId: string): Promise<void> {
  const rows = await prisma.chatMessage.findMany({
    where: { orgId, kind: "ads_proposal", deletedAt: null, meta: { path: ["proposalId"], equals: proposalId } },
  });
  if (rows.length === 0) return;
  const messages = await hydrateMessages(orgId, rows);
  for (const m of messages) {
    await broadcastToChannel(orgId, m.channelId, { type: "chat.message.updated", channelId: m.channelId, message: m });
  }
}

/** ขึ้น "Ads Agent กำลังพิมพ์…" ในกลุ่มระหว่าง AI คิด */
export async function botTyping(orgId: string): Promise<void> {
  const channelId = await ensureBotGroup(orgId);
  await broadcastToChannel(orgId, channelId, { type: "chat.typing", channelId, userId: ADS_BOT_AUTHOR });
}

/**
 * เรียกจาก createMessage ทุกข้อความ — ข้อความในกลุ่ม Ads Agent ส่งต่อให้ n8n (webhook bot.message)
 * ห้องอื่นไม่ทำอะไร · ไม่ throw (ส่งไม่ถึง n8n ต้องไม่ทำให้ส่งข้อความพลาด)
 */
export async function forwardToAgent(
  actor: ChatActor,
  channelId: string,
  row: { id: string; body: string | null; replyToId: string | null; createdAt: Date }
): Promise<void> {
  if (channelId !== botChannelId(actor.orgId) || !row.body) return;
  try {
    const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
    const result = await sendAgentWebhook(actor.orgId, "bot.message", {
      user_id: actor.userId,
      user_name: user?.name ?? null,
      message_id: row.id,
      reply_to_message_id: row.replyToId,
      text: row.body,
      sent_at: row.createdAt.toISOString(),
      // สมาชิกกลุ่มทุกคนอนุมัติได้ (คนพิมพ์อยู่ในกลุ่มแน่นอน ไม่งั้นส่งข้อความเข้ากลุ่มไม่ได้)
      can_approve: true,
    });
    if (!result.ok) {
      await postBotText(actor.orgId, "ตอนนี้ติดต่อ n8n ไม่ได้ ข้อความนี้ยังไม่ถึง AI — ลองใหม่อีกครั้งภายหลัง หรือแจ้งผู้ดูแลระบบให้ดูเครื่อง n8n", {
        replyToId: row.id,
      });
    }
  } catch (err) {
    console.error("[ads-bot] ส่งข้อความต่อให้ n8n ไม่สำเร็จ:", err);
  }
}
