import "server-only";
import { prisma } from "@smartboss/database";
import { AccessToken } from "livekit-server-sdk";

import { publishToUsers } from "@/lib/realtime/server";
import { sendWebPush } from "@/lib/web-push";
import { CHAT_PAGE_PATH } from "../constants";
import type { ChatCallDTO } from "../types";
import { getChannelAccess, postSystemMessage } from "./channels";
import { ChatError, type ChatActor } from "./serialize";

/**
 * โทรในแชท (เสียง) — เซิร์ฟเวอร์เราคุมแค่สถานะสาย + ส่งสัญญาณ "สายเข้า/รับ/วาง" ผ่านท่อสดเดิม (realtime)
 * และ Web Push · เสียงจริงวิ่งผ่าน LiveKit (ตัวกลางที่ต่อสายผ่านเน็ตบริษัท/มือถือได้ — ตัวที่ทำให้เสถียร)
 *
 * ค่าตั้ง (ไฟล์ /etc/smartboss/smartboss.env เท่านั้น ห้ามใส่ในโค้ด): LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
 * ไม่ได้ตั้ง = ไม่มีปุ่มโทร (callsEnabled) ส่วนอื่นของแชทใช้ได้ตามปกติ
 *
 * ขอบเขตรอบแรก: โทรเสียงตัวต่อตัวในแชทส่วนตัว (DM) · แต่ละบริษัทแยกด้วย orgId ทุกคิวรี ·
 * ตาราง chat.calls ใช้นับนาทีที่แต่ละบริษัทใช้ (ระบบนี้ขายให้บริษัทอื่นด้วย)
 */

/** เรียกเข้าได้นานเท่านี้ ไม่มีคนรับ = สายที่ไม่ได้รับ (ฝั่งผู้โทรวางเองตอนครบ · เซิร์ฟเวอร์เก็บกวาดเผื่อผู้โทรปิดแอปไป) */
export const RING_TIMEOUT_MS = 45_000;
/** สายที่ค้าง "คุยอยู่" นานเกินนี้โดยไม่มีใครกดวาง (ปิดแอปทั้งคู่) = ถือว่าจบ — กันสายค้างตลอดกาลจนโทรหาใครไม่ได้ */
const STALE_ACTIVE_MS = 4 * 3_600_000;
const TOKEN_TTL = "2h";

function livekitConfig() {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  return url && key && secret ? { url, key, secret } : null;
}

export function callsEnabled(): boolean {
  return livekitConfig() !== null;
}

function roomName(callId: string) {
  return `call-${callId}`;
}

async function tokenFor(callId: string, userId: string, name: string): Promise<{ url: string; token: string }> {
  const cfg = livekitConfig();
  if (!cfg) throw new ChatError("ระบบโทรยังไม่ได้ตั้งค่า", 503);
  const at = new AccessToken(cfg.key, cfg.secret, { identity: userId, name, ttl: TOKEN_TTL });
  // สิทธิ์เฉพาะห้องของสายนี้ · เสียงอย่างเดียวรอบนี้ (ห้ามส่งภาพ/แชร์จอ)
  at.addGrant({ room: roomName(callId), roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false, canPublishSources: [] });
  return { url: cfg.url, token: await at.toJwt() };
}

type CallRow = {
  id: string;
  orgId: string;
  channelId: string;
  callerId: string;
  calleeId: string;
  media: string;
  status: string;
  createdAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
};

async function names(orgId: string, ids: string[]) {
  const rows = await prisma.user.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

function toDTO(c: CallRow, nameOf: Map<string, string>): ChatCallDTO {
  return {
    id: c.id,
    channelId: c.channelId,
    callerId: c.callerId,
    calleeId: c.calleeId,
    callerName: nameOf.get(c.callerId) ?? "",
    calleeName: nameOf.get(c.calleeId) ?? "",
    media: c.media === "video" ? "video" : "audio",
    status: c.status as ChatCallDTO["status"],
    createdAt: c.createdAt.toISOString(),
    answeredAt: c.answeredAt?.toISOString() ?? null,
    endedAt: c.endedAt?.toISOString() ?? null,
  };
}

function durationLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** สายที่ค้างเกินเวลา (ผู้โทรปิดแอปตอนเรียกเข้า / ปิดแอปทั้งคู่ระหว่างคุย) — ปิดให้ แล้วแจ้งทุกฝ่ายเหมือนวางตามปกติ */
async function sweepStale(orgId: string, userIds: string[]) {
  const now = Date.now();
  const stale = await prisma.chatCall.findMany({
    where: {
      orgId,
      OR: [
        { status: "ringing", createdAt: { lt: new Date(now - RING_TIMEOUT_MS - 15_000) } },
        { status: "active", answeredAt: { lt: new Date(now - STALE_ACTIVE_MS) } },
      ],
      AND: [{ OR: [{ callerId: { in: userIds } }, { calleeId: { in: userIds } }] }],
    },
  });
  for (const c of stale) await finish(c, null, c.status === "ringing" ? "missed" : "ended");
}

/** ปิดสาย (ทุกทางจบ) — เปลี่ยนสถานะแบบมีเงื่อนไข (ชนกันสองเครื่องได้แค่ครั้งเดียว) · ข้อความในห้อง · แจ้งทุกเครื่อง */
async function finish(c: CallRow, actorId: string | null, status: "ended" | "missed" | "declined"): Promise<CallRow | null> {
  const endedAt = new Date();
  const changed = await prisma.chatCall.updateMany({
    where: { id: c.id, orgId: c.orgId, status: { in: ["ringing", "active"] } },
    data: { status, endedAt, endedBy: actorId },
  });
  if (changed.count === 0) return null;
  const row: CallRow = { ...c, status, endedAt };
  const nameOf = await names(c.orgId, [c.callerId, c.calleeId]);
  const dto = toDTO(row, nameOf);

  const caller = nameOf.get(c.callerId) ?? "ผู้โทร";
  const body =
    status === "ended" && c.answeredAt
      ? `📞 โทรด้วยเสียง · ${durationLabel(endedAt.getTime() - c.answeredAt.getTime())}`
      : status === "declined"
        ? `📞 ${nameOf.get(c.calleeId) ?? "ผู้รับ"} ปฏิเสธสาย`
        : `📞 สายที่ไม่ได้รับจาก ${caller}`;
  await postSystemMessage(c.orgId, c.channelId, c.callerId, body).catch((err) => console.error("[calls] system message failed", err));

  publishToUsers([c.callerId, c.calleeId], { type: "call.update", call: dto });
  // เครื่องของผู้รับที่ไม่ได้เปิดแอปอยู่ — แทนแจ้งเตือน "สายเข้า" (tag เดียวกัน) ไม่ให้ค้างชวนกดรับสายที่จบไปแล้ว
  if (!c.answeredAt) {
    await sendWebPush(c.orgId, [c.calleeId], {
      title: status === "declined" ? "📞 ปฏิเสธสายแล้ว" : `📞 สายที่ไม่ได้รับจาก ${caller}`,
      body: status === "declined" ? caller : "แตะเพื่อเปิดแชท",
      url: `${CHAT_PAGE_PATH}?c=${encodeURIComponent(c.channelId)}`,
      tag: `call-${c.id}`,
      kind: "call-end",
      ttl: 3600,
    }).catch(() => undefined);
  }
  return row;
}

async function loadCall(actor: ChatActor, callId: string): Promise<CallRow> {
  const c = await prisma.chatCall.findFirst({ where: { id: callId, orgId: actor.orgId } });
  if (!c || (c.callerId !== actor.userId && c.calleeId !== actor.userId)) throw new ChatError("ไม่พบสายนี้", 404);
  return c;
}

/** เริ่มโทร — เฉพาะแชทส่วนตัว · ปลายสายไม่ว่าง (มีสายอื่นค้าง) = ตอบกลับทันที ไม่เรียกเข้า */
export async function startCall(actor: ChatActor, channelId: string): Promise<{ call: ChatCallDTO; url: string; token: string }> {
  if (!callsEnabled()) throw new ChatError("ระบบโทรยังไม่ได้ตั้งค่า", 503);
  const access = await getChannelAccess(actor, channelId);
  if (access.type !== "dm") throw new ChatError("โทรได้เฉพาะแชทส่วนตัว", 400);
  const members = await prisma.chatChannelMember.findMany({ where: { orgId: actor.orgId, channelId }, select: { userId: true } });
  const calleeId = members.map((m) => m.userId).find((id) => id !== actor.userId);
  if (!calleeId) throw new ChatError("ไม่พบปลายสาย", 404);
  const callee = await prisma.user.findFirst({ where: { id: calleeId, orgId: actor.orgId, isActive: true }, select: { id: true } });
  if (!callee) throw new ChatError("ปลายสายไม่ได้ใช้งานระบบแล้ว", 400);

  await sweepStale(actor.orgId, [actor.userId, calleeId]);
  const busy = await prisma.chatCall.findFirst({
    where: {
      orgId: actor.orgId,
      status: { in: ["ringing", "active"] },
      OR: [{ callerId: { in: [actor.userId, calleeId] } }, { calleeId: { in: [actor.userId, calleeId] } }],
    },
    select: { callerId: true, calleeId: true },
  });
  if (busy) {
    const meBusy = busy.callerId === actor.userId || busy.calleeId === actor.userId;
    throw new ChatError(meBusy ? "คุณมีสายที่ยังไม่จบอยู่" : "ปลายสายไม่ว่าง กำลังคุยสายอื่นอยู่", 409);
  }

  const row = await prisma.chatCall.create({ data: { orgId: actor.orgId, channelId, callerId: actor.userId, calleeId } });
  const nameOf = await names(actor.orgId, [actor.userId, calleeId]);
  const dto = toDTO(row, nameOf);
  const callerName = nameOf.get(actor.userId) ?? "เพื่อนร่วมงาน";

  // เปิดแอปอยู่ = ขึ้นจอรับสายทันทีทางท่อสด · ไม่ได้เปิด = Web Push (ค้างจนกว่าจะกด / ถูกแทนตอนสายจบ — ดู sw.js)
  publishToUsers([calleeId], { type: "call.ring", call: dto });
  await sendWebPush(actor.orgId, [calleeId], {
    title: `📞 สายเข้าจาก ${callerName}`,
    body: "แตะเพื่อรับสาย",
    url: `${CHAT_PAGE_PATH}?c=${encodeURIComponent(channelId)}&call=${row.id}`,
    tag: `call-${row.id}`,
    kind: "call",
    callId: row.id,
    // ส่งช้ากว่าสายจะหมดเวลา = ไม่ต้องเด้งแล้ว
    ttl: Math.round(RING_TIMEOUT_MS / 1000),
  }).catch((err) => console.error("[calls] push failed", err));

  return { call: dto, ...(await tokenFor(row.id, actor.userId, callerName)) };
}

export async function answerCall(actor: ChatActor, callId: string): Promise<{ call: ChatCallDTO; url: string; token: string }> {
  const c = await loadCall(actor, callId);
  if (c.calleeId !== actor.userId) throw new ChatError("ไม่ใช่สายของคุณ", 403);
  const answeredAt = new Date();
  const changed = await prisma.chatCall.updateMany({ where: { id: c.id, orgId: c.orgId, status: "ringing" }, data: { status: "active", answeredAt } });
  if (changed.count === 0) throw new ChatError(c.status === "active" ? "รับสายในเครื่องอื่นแล้ว" : "สายนี้จบไปแล้ว", 409);
  const nameOf = await names(c.orgId, [c.callerId, c.calleeId]);
  const dto = toDTO({ ...c, status: "active", answeredAt }, nameOf);
  // ทั้งสองฝั่ง: ผู้โทรเริ่มนับเวลา · เครื่องอื่นของผู้รับปิดจอเรียกเข้า
  publishToUsers([c.callerId, c.calleeId], { type: "call.update", call: dto });
  return { call: dto, ...(await tokenFor(c.id, actor.userId, nameOf.get(actor.userId) ?? "")) };
}

export async function declineCall(actor: ChatActor, callId: string): Promise<void> {
  const c = await loadCall(actor, callId);
  if (c.calleeId !== actor.userId) throw new ChatError("ไม่ใช่สายของคุณ", 403);
  if (c.status !== "ringing") return;
  await finish(c, actor.userId, "declined");
}

/** วางสาย — ผู้โทรวางก่อนมีคนรับ / ครบเวลาเรียกเข้า = สายที่ไม่ได้รับ · คุยอยู่ = จบสายปกติ */
export async function endCall(actor: ChatActor, callId: string): Promise<void> {
  const c = await loadCall(actor, callId);
  if (c.status === "ringing") await finish(c, actor.userId, "missed");
  else if (c.status === "active") await finish(c, actor.userId, "ended");
}

/** สายที่ยังไม่จบของฉัน — เปิดหน้าจากแจ้งเตือนสายเข้า / รีเฟรชระหว่างคุย ให้จอโทรกลับมาถูกสถานะ */
export async function myCurrentCall(actor: ChatActor): Promise<ChatCallDTO | null> {
  await sweepStale(actor.orgId, [actor.userId]);
  const c = await prisma.chatCall.findFirst({
    where: { orgId: actor.orgId, status: { in: ["ringing", "active"] }, OR: [{ callerId: actor.userId }, { calleeId: actor.userId }] },
    orderBy: { createdAt: "desc" },
  });
  if (!c) return null;
  return toDTO(c, await names(c.orgId, [c.callerId, c.calleeId]));
}

/** กลับเข้าสายที่คุยอยู่ (รีเฟรช/สลับเครื่องระหว่างคุย) — ได้ token ใหม่ของสายเดิม */
export async function rejoinCall(actor: ChatActor, callId: string): Promise<{ call: ChatCallDTO; url: string; token: string }> {
  const c = await loadCall(actor, callId);
  if (c.status !== "active") throw new ChatError("สายนี้จบไปแล้ว", 409);
  const nameOf = await names(c.orgId, [c.callerId, c.calleeId]);
  return { call: toDTO(c, nameOf), ...(await tokenFor(c.id, actor.userId, nameOf.get(actor.userId) ?? "")) };
}

/** นาทีที่บริษัทใช้โทร ช่วงเวลาหนึ่ง (นับรายคน: สาย 2 คน = 2 เท่า ตรงกับที่ LiveKit คิด) — ไว้ดูโควตา/คิดเงินลูกค้า */
export async function callMinutesUsed(orgId: string, from: Date, to: Date): Promise<number> {
  const rows = await prisma.chatCall.findMany({
    where: { orgId, answeredAt: { not: null, gte: from, lt: to }, endedAt: { not: null } },
    select: { answeredAt: true, endedAt: true },
  });
  const ms = rows.reduce((n, r) => n + (r.endedAt!.getTime() - r.answeredAt!.getTime()), 0);
  return Math.ceil((ms / 60_000) * 2);
}
