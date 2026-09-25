import "server-only";
import { prisma } from "@smartboss/database";

import { activeUserIds } from "@/lib/realtime/server";
import { sendWebPush } from "@/lib/web-push";
import { notifyUsers } from "@/modules/maintenance/data/notify";
import type { ChatMessageDTO } from "../types";
import { otherMemberIds } from "./messages";
import type { ChatActor } from "./serialize";

/**
 * แจ้งเตือนข้อความใหม่ — ลำดับจากถูกไปแพง (ดูแผนแชท):
 *  1. คนที่กำลังดูหน้าเว็บอยู่ → ได้ทางท่อสดไปแล้ว (หน้าเว็บเด้งและมีเสียงเอง)
 *  2. คนที่ไม่ได้ดูหน้าจอ (ปิดเว็บ, ย่อเบราว์เซอร์, ล็อกจอ) → Web Push (ฟรี) เสียงแจ้งเตือนของเครื่อง
 *  3. ถูก @แท็ก → ลงกระดิ่งรวมด้วย (core.notifications) กันหลุด
 *
 * แชททั่วไปไม่ลงกระดิ่ง (เหมือน LINE) — เดิมลงทุกข้อความ กระดิ่งเต็มไปด้วยแชทจนแจ้งเตือนอื่นจม
 * ห้องที่ปิดเสียงไว้ไม่เด้ง ยกเว้นถูกแท็กชื่อตัวเอง
 * ห้องรวมทั้งบริษัทไม่เด้งทุกข้อความ (คนเป็นพัน) — เด้งเฉพาะคนที่ถูกแท็ก และ @ทุกคน จากแอดมินแชท
 *
 * ไม่ throw — แจ้งเตือนพลาดต้องไม่ทำให้ส่งข้อความพลาด
 */
export async function notifyNewMessage(
  actor: ChatActor,
  channelId: string,
  channelType: string,
  memberIds: string[],
  message: ChatMessageDTO
): Promise<void> {
  try {
    if (message.kind !== "text") return;
    const mentionAll = message.mentions.includes("all") && (channelType !== "org" || actor.isChatAdmin);
    const directMentions = new Set(message.mentions.filter((m) => m !== "all" && m !== actor.userId));

    let candidates: string[];
    if (channelType === "org") {
      candidates = mentionAll ? await otherMemberIds(actor.orgId, channelId, actor.userId) : [...directMentions];
    } else {
      candidates = memberIds.filter((id) => id !== actor.userId);
    }
    if (candidates.length === 0) return;

    const [prefs, channel, author] = await Promise.all([
      prisma.chatReadState.findMany({
        where: { orgId: actor.orgId, channelId, userId: { in: candidates }, muted: true },
        select: { userId: true },
      }),
      prisma.chatChannel.findFirst({ where: { id: channelId, orgId: actor.orgId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } }),
    ]);
    const muted = new Set(prefs.map((p) => p.userId));
    const recipients = candidates.filter((id) => !muted.has(id) || directMentions.has(id));
    if (recipients.length === 0) return;

    const authorName = author?.name ?? "เพื่อนร่วมงาน";
    const preview =
      message.body?.slice(0, 140) ||
      (message.attachments[0]?.kind === "image"
        ? "ส่งรูปภาพ"
        : message.attachments[0]?.kind === "audio"
          ? "ส่งข้อความเสียง"
          : message.attachments[0]?.kind === "video"
            ? "ส่งวิดีโอ"
            : "ส่งไฟล์");
    const url = `/report-task/chat?c=${encodeURIComponent(channelId)}`;
    const isDm = channelType === "dm";

    // ส่งเด้งให้ทุกคนที่ "ไม่ได้ดูหน้าจอ" — รวมคนที่เปิดเว็บค้างไว้แต่ย่อเบราว์เซอร์/ล็อกจอ
    // (คนที่ดูหน้าจออยู่ได้ทางท่อสดแล้ว หน้าเว็บเด้งให้เอง)
    const active = await activeUserIds(recipients);
    const offline = recipients.filter((id) => !active.has(id));
    const pushes: Promise<void>[] = [];
    if (offline.length > 0) {
      const mentioned = offline.filter((id) => directMentions.has(id) || mentionAll);
      const others = offline.filter((id) => !mentioned.includes(id));
      const groupTitle = channel?.name ?? "แชท";
      if (others.length > 0) {
        pushes.push(
          sendWebPush(actor.orgId, others, {
            title: isDm ? authorName : groupTitle,
            body: isDm ? preview : `${authorName}: ${preview}`,
            url,
            tag: `chat-${channelId}`,
          })
        );
      }
      if (mentioned.length > 0) {
        pushes.push(
          sendWebPush(actor.orgId, mentioned, {
            title: `${authorName} แท็กคุณ${isDm ? "" : ` ใน ${groupTitle}`}`,
            body: preview,
            url,
            tag: `chat-${channelId}`,
          })
        );
      }
    }

    const bell = recipients.filter((id) => directMentions.has(id) || mentionAll);
    if (bell.length > 0) {
      pushes.push(
        notifyUsers(actor.orgId, bell, {
          title: `${authorName} แท็กคุณในแชท${channel?.name ? ` "${channel.name}"` : ""}`,
          body: preview,
          type: "chat_mention",
          referenceId: channelId,
        })
      );
    }
    await Promise.all(pushes);
  } catch (err) {
    console.error("[chat] notify failed", err);
  }
}
