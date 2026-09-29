import "server-only";
import { prisma } from "@smartboss/database";
import { crossOrg } from "@smartboss/database/cross-org";

import { deleteFiles } from "@/lib/storage";
import type { ChatAttachment } from "../types";
import { CHAT_MEDIA_RETENTION_DAYS, CHAT_MEDIA_RETENTION_START, EXPIRING_KINDS } from "../lib/retention";

/**
 * เก็บกวาดรูป/วิดีโอ/ข้อความเสียงในแชทที่หมดอายุ (lib/retention.ts) — รันทุกคืนจาก cron
 * (/api/cron/maintenance?task=chat-media หรือ all) ทำงานข้ามทุกบริษัท
 *
 * ต่อไฟล์แนบที่หมดอายุ:
 *   - อยู่ในอัลบั้ม (url หรือรูปย่อ) → ไม่แตะ เก็บถาวร
 *   - ไม่อยู่ → ลบไฟล์จริง (+ รูปย่อ) ออกจาก storage, ลบแถว chat.files (คืนโควตาพื้นที่ของบริษัท)
 *     แล้วเปลี่ยนไฟล์แนบในข้อความเป็นร่องรอย { expired: true, url: "" } — ข้อความตัวหนังสือยังอยู่
 * ไฟล์เดียวกันแนบอยู่ในข้อความอื่นที่ยังไม่หมดอายุ (API ส่ง url เดิมซ้ำได้) → ยังไม่ลบไฟล์
 *
 * รันซ้ำได้ ไฟล์แนบที่ expired แล้วถูกข้าม · ไม่ throw ต่อข้อความ — ข้อความหนึ่งพังไม่หยุดทั้งรอบ
 */
export async function purgeExpiredChatMedia(opts: { dryRun?: boolean } = {}): Promise<{
  messages: number;
  files: number;
  bytes: number;
  kept: number;
}> {
  const DAY = 24 * 60 * 60 * 1000;
  const sentBefore = new Date(Date.now() - CHAT_MEDIA_RETENTION_DAYS * DAY);
  // ยังไม่ครบ 30 วันนับจากวันเปิดใช้ = ยังไม่มีอะไรหมดอายุเลย
  if (sentBefore.getTime() <= new Date(CHAT_MEDIA_RETENTION_START).getTime()) return { messages: 0, files: 0, bytes: 0, kept: 0 };

  const result = { messages: 0, files: 0, bytes: 0, kept: 0 };
  let cursor: bigint | undefined;
  for (;;) {
    const rows = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
      prisma.chatMessage.findMany({
        where: {
          createdAt: { lt: sentBefore },
          ...(cursor ? { seq: { gt: cursor } } : {}),
          OR: [...EXPIRING_KINDS].map((kind) => ({ attachments: { array_contains: [{ kind }] } })),
        },
        orderBy: { seq: "asc" },
        take: 200,
        select: { id: true, orgId: true, seq: true, attachments: true },
      })
    );
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.seq;

    for (const row of rows) {
      try {
        const atts = (row.attachments as ChatAttachment[] | null) ?? [];
        const due = atts.filter((a) => EXPIRING_KINDS.has(a.kind) && !a.expired && a.url);
        if (due.length === 0) continue;
        const urls = due.flatMap((a) => [a.url, ...(a.thumbUrl ? [a.thumbUrl] : [])]);

        const inAlbum = new Set(
          (
            await prisma.chatAlbumItem.findMany({
              where: { orgId: row.orgId, OR: [{ url: { in: urls } }, { thumbUrl: { in: urls } }] },
              select: { url: true, thumbUrl: true },
            })
          ).flatMap((i) => [i.url, i.thumbUrl])
        );

        const expire = due.filter((a) => !inAlbum.has(a.url));
        result.kept += due.length - expire.length;
        if (expire.length === 0) continue;

        // ไฟล์ที่ยังถูกใช้ในข้อความอื่นที่ยังไม่หมดอายุ — เปลี่ยนเป็นร่องรอยได้ แต่ห้ามลบไฟล์จริง
        const toDelete: string[] = [];
        for (const url of expire.flatMap((a) => [a.url, ...(a.thumbUrl ? [a.thumbUrl] : [])])) {
          const newer = await prisma.chatMessage.findFirst({
            where: {
              orgId: row.orgId,
              id: { not: row.id },
              createdAt: { gte: sentBefore },
              OR: [{ attachments: { array_contains: [{ url }] } }, { attachments: { array_contains: [{ thumbUrl: url }] } }],
            },
            select: { id: true },
          });
          if (!newer && !inAlbum.has(url)) toDelete.push(url);
        }

        const expiredUrls = new Set(expire.map((a) => a.url));
        const next = atts.map((a) => {
          if (!expiredUrls.has(a.url)) return a;
          const { url: _url, thumbUrl: _thumb, ...rest } = a;
          return { ...rest, url: "", expired: true };
        });

        const sizes = await prisma.chatFile.findMany({ where: { orgId: row.orgId, url: { in: toDelete } }, select: { size: true } });
        result.messages += 1;
        result.files += toDelete.length;
        result.bytes += sizes.reduce((s, f) => s + f.size, 0);
        if (opts.dryRun) continue;

        // เขียนร่องรอยก่อน ค่อยลบไฟล์ — ถ้าลบไฟล์พลาดกลางทาง ข้อความก็ไม่ชี้ไปไฟล์ที่หายแล้ว
        await prisma.chatMessage.update({ where: { id: row.id }, data: { attachments: next as unknown as object } });
        if (toDelete.length > 0) {
          await deleteFiles(toDelete);
          await prisma.chatFile.deleteMany({ where: { orgId: row.orgId, url: { in: toDelete } } });
        }
      } catch (err) {
        console.error("[chat] purge expired media failed for message", row.id, err);
      }
    }
  }
  return result;
}
