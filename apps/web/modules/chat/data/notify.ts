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
 *  2. เครื่องที่ไม่ได้ดูหน้าจอ (ปิดเว็บ, ย่อเบราว์เซอร์, ล็อกจอ) → Web Push (ฟรี) เสียงแจ้งเตือนของเครื่อง
 *  3. ถูก @แท็ก → ลงกระดิ่งรวมด้วย (core.notifications) กันหลุด
 *
 * แชททั่วไปไม่ลงกระดิ่ง (เหมือน LINE) — เดิมลงทุกข้อความ กระดิ่งเต็มไปด้วยแชทจนแจ้งเตือนอื่นจม
 *
 * แบบ LINE: ทุกห้องเด้งทุกข้อความ รวมห้องรวมทั้งบริษัท (เดิมห้องรวมเด้งเฉพาะคนถูกแท็ก
 * — ข้อความในห้องรวมเงียบหายไม่มีใครรู้) ใครไม่อยากได้ ปิดเสียงห้องนั้นเอง
 * ห้องที่ปิดเสียงไว้ยังเด้งเมื่อ "เรื่องนั้นเกี่ยวกับเรา": ถูกแท็กชื่อ, @ทุกคน, ตอบกลับข้อความของเรา
 * @ทุกคน ในห้องรวมยังจำกัดเฉพาะแอดมินแชท (ทะลุการปิดเสียงของทั้งบริษัท)
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
    // ตอบกลับข้อความของใคร = เรื่องนี้เกี่ยวกับคนนั้น เด้งแม้ปิดเสียงห้องไว้ (แบบ LINE)
    const repliedTo =
      message.replyTo && !message.replyTo.deleted && message.replyTo.authorId !== actor.userId ? message.replyTo.authorId : null;
    const aboutMe = (id: string) => directMentions.has(id) || mentionAll || id === repliedTo;

    const candidates =
      channelType === "org"
        ? await otherMemberIds(actor.orgId, channelId, actor.userId)
        : memberIds.filter((id) => id !== actor.userId);
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
    const recipients = candidates.filter((id) => !muted.has(id) || aboutMe(id));
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

    // เด้งเข้าเครื่องที่ไม่ได้ดูหน้าจอ (sendWebPush ข้ามเครื่องที่ดูอยู่ให้เอง — เครื่องนั้นเด้งในแอปแล้ว)
    //  - เรื่องของเรา (แชทส่วนตัว, ถูกแท็ก, ตอบกลับเรา) → ทุกเครื่องที่ไม่ได้ดูจอ แม้กำลังใช้อีกเครื่องอยู่
    //  - แชทกลุ่มทั่วไป → เฉพาะคนที่ไม่ได้ดูหน้าจอเครื่องไหนเลย (ดูในคอมอยู่แล้ว มือถือไม่ต้องสั่นทุกข้อความ)
    const mentioned = recipients.filter((id) => directMentions.has(id) || mentionAll);
    const replied = recipients.filter((id) => id === repliedTo && !mentioned.includes(id));
    let others = recipients.filter((id) => !mentioned.includes(id) && !replied.includes(id));
    if (!isDm && others.length > 0) {
      const active = await activeUserIds(others);
      others = others.filter((id) => !active.has(id));
    }
    const groupTitle = channel?.name ?? "แชท";
    const pushes: Promise<void>[] = [];
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
    if (replied.length > 0) {
      pushes.push(
        sendWebPush(actor.orgId, replied, {
          title: `${authorName} ตอบกลับข้อความของคุณ${isDm ? "" : ` ใน ${groupTitle}`}`,
          body: preview,
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
