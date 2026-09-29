import "server-only";
import { prisma } from "@smartboss/database";

import { deleteFiles } from "@/lib/storage";
import type { ChatAlbumDTO, ChatAlbumItemDTO, ChatAttachment } from "../types";
import { getChannelAccess } from "./channels";
import { ChatError, type ChatActor } from "./serialize";

/**
 * อัลบั้มของห้องแชท (แบบ LINE) — ที่เก็บรูป/วิดีโอถาวร ส่วนในแชทหมดอายุ (lib/retention.ts)
 *
 * รายการในอัลบั้มชี้ไปที่ไฟล์เดิมใน chat.files ไม่ได้ก๊อป ⇒ บันทึกรูปจากแชทไม่เปลืองพื้นที่เพิ่ม
 * ใครอยู่ในห้องก็ดู/สร้าง/เพิ่มรูปได้ · ลบรูปออก = คนที่เพิ่มรูปนั้น หรือแอดมินห้อง
 * · เปลี่ยนชื่อ/ลบอัลบั้ม = คนสร้างอัลบั้ม หรือแอดมินห้อง
 */

const MAX_ALBUMS_PER_CHANNEL = 100;
const MAX_ITEMS_PER_ADD = 50;

async function albumWithAccess(actor: ChatActor, albumId: string) {
  const album = await prisma.chatAlbum.findFirst({ where: { id: albumId, orgId: actor.orgId } });
  if (!album) throw new ChatError("ไม่พบอัลบั้มนี้", 404);
  const access = await getChannelAccess(actor, album.channelId);
  return { album, access };
}

function cleanName(name: unknown): string {
  const clean = typeof name === "string" ? name.trim().slice(0, 100) : "";
  if (!clean) throw new ChatError("ตั้งชื่ออัลบั้มก่อน", 400);
  return clean;
}

export async function listAlbums(actor: ChatActor, channelId: string): Promise<ChatAlbumDTO[]> {
  await getChannelAccess(actor, channelId);
  const albums = await prisma.chatAlbum.findMany({
    where: { orgId: actor.orgId, channelId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { items: true } },
      items: { orderBy: { createdAt: "desc" }, take: 1, select: { url: true, thumbUrl: true, kind: true } },
    },
  });
  return albums.map((a) => ({
    id: a.id,
    channelId: a.channelId,
    name: a.name,
    createdById: a.createdById,
    itemCount: a._count.items,
    cover: a.items[0] ? { url: a.items[0].url, thumbUrl: a.items[0].thumbUrl, kind: a.items[0].kind } : null,
    updatedAt: a.updatedAt.toISOString(),
  }));
}

export async function createAlbum(actor: ChatActor, channelId: string, name: unknown): Promise<{ id: string }> {
  await getChannelAccess(actor, channelId);
  const count = await prisma.chatAlbum.count({ where: { orgId: actor.orgId, channelId } });
  if (count >= MAX_ALBUMS_PER_CHANNEL) throw new ChatError(`ห้องหนึ่งมีอัลบั้มได้ไม่เกิน ${MAX_ALBUMS_PER_CHANNEL} อัลบั้ม`, 400);
  const album = await prisma.chatAlbum.create({
    data: { orgId: actor.orgId, channelId, name: cleanName(name), createdById: actor.userId },
  });
  return { id: album.id };
}

export async function getAlbum(actor: ChatActor, albumId: string): Promise<{ album: ChatAlbumDTO; items: ChatAlbumItemDTO[]; canManage: boolean }> {
  const { album, access } = await albumWithAccess(actor, albumId);
  const items = await prisma.chatAlbumItem.findMany({ where: { orgId: actor.orgId, albumId }, orderBy: { createdAt: "desc" } });
  const canManage = album.createdById === actor.userId || access.canManage;
  return {
    album: {
      id: album.id,
      channelId: album.channelId,
      name: album.name,
      createdById: album.createdById,
      itemCount: items.length,
      cover: items[0] ? { url: items[0].url, thumbUrl: items[0].thumbUrl, kind: items[0].kind } : null,
      updatedAt: album.updatedAt.toISOString(),
    },
    items: items.map((i) => ({
      id: i.id,
      url: i.url,
      thumbUrl: i.thumbUrl,
      kind: i.kind === "video" ? "video" : "image",
      mime: i.mime,
      name: i.name,
      width: i.width,
      height: i.height,
      addedById: i.addedById,
      createdAt: i.createdAt.toISOString(),
      canRemove: i.addedById === actor.userId || access.canManage,
    })),
    canManage,
  };
}

export async function renameAlbum(actor: ChatActor, albumId: string, name: unknown): Promise<void> {
  const { album, access } = await albumWithAccess(actor, albumId);
  if (album.createdById !== actor.userId && !access.canManage) throw new ChatError("เฉพาะคนสร้างอัลบั้มหรือแอดมินห้อง", 403);
  await prisma.chatAlbum.update({ where: { id: albumId }, data: { name: cleanName(name) } });
}

/**
 * เพิ่มรูป/วิดีโอเข้าอัลบั้ม — ไฟล์ต้องเป็นของบริษัทนี้ (chat.files) และยังไม่หมดอายุ
 * มาจากแชท (sourceMessageId) ต้องเป็นข้อความในห้องเดียวกับอัลบั้มจริง กันยิง url ของห้องอื่นเข้ามา
 */
export async function addAlbumItems(
  actor: ChatActor,
  albumId: string,
  input: unknown
): Promise<{ added: number }> {
  const { album } = await albumWithAccess(actor, albumId);
  const raw = Array.isArray(input) ? input.slice(0, MAX_ITEMS_PER_ADD) : [];
  const wanted = raw.filter((i): i is { url: string; thumbUrl?: unknown; name?: unknown; width?: unknown; height?: unknown; sourceMessageId?: unknown } => typeof i?.url === "string");
  if (wanted.length === 0) throw new ChatError("ไม่มีรูปให้เพิ่ม", 400);

  const urls = wanted.flatMap((i) => [i.url, ...(typeof i.thumbUrl === "string" ? [i.thumbUrl] : [])]);
  const files = await prisma.chatFile.findMany({ where: { orgId: actor.orgId, url: { in: urls } }, select: { url: true, mime: true, kind: true } });
  const fileByUrl = new Map(files.map((f) => [f.url, f]));

  const sourceIds = [...new Set(wanted.map((i) => i.sourceMessageId).filter((id): id is string => typeof id === "string"))];
  const sources = sourceIds.length
    ? await prisma.chatMessage.findMany({
        where: { orgId: actor.orgId, id: { in: sourceIds }, channelId: album.channelId, deletedAt: null },
        select: { id: true, attachments: true },
      })
    : [];
  const sourceAttachments = new Map(sources.map((m) => [m.id, (m.attachments as ChatAttachment[] | null) ?? []]));

  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 20000 ? Math.round(v) : null);
  const rows = [];
  for (const i of wanted) {
    const file = fileByUrl.get(i.url);
    if (!file || (file.kind !== "image" && file.kind !== "video")) throw new ChatError("เพิ่มได้เฉพาะรูปหรือวิดีโอที่ยังไม่หมดอายุ", 400);
    const sourceId = typeof i.sourceMessageId === "string" ? i.sourceMessageId : null;
    if (sourceId) {
      const att = sourceAttachments.get(sourceId)?.find((a) => a.url === i.url);
      if (!att || att.expired) throw new ChatError("รูปนี้หมดอายุหรือไม่ได้อยู่ในห้องนี้แล้ว", 400);
    }
    const thumb = typeof i.thumbUrl === "string" && fileByUrl.has(i.thumbUrl) ? i.thumbUrl : null;
    rows.push({
      orgId: actor.orgId,
      albumId,
      url: file.url,
      thumbUrl: thumb,
      kind: file.kind,
      mime: file.mime,
      name: typeof i.name === "string" ? i.name.slice(0, 200) : "รูปภาพ",
      width: num(i.width),
      height: num(i.height),
      sourceMessageId: sourceId,
      addedById: actor.userId,
    });
  }
  const res = await prisma.chatAlbumItem.createMany({ data: rows, skipDuplicates: true });
  await prisma.chatAlbum.update({ where: { id: albumId }, data: { updatedAt: new Date() } });
  return { added: res.count };
}

export async function removeAlbumItem(actor: ChatActor, albumId: string, itemId: string): Promise<void> {
  const { access } = await albumWithAccess(actor, albumId);
  const item = await prisma.chatAlbumItem.findFirst({ where: { id: itemId, albumId, orgId: actor.orgId } });
  if (!item) return;
  if (item.addedById !== actor.userId && !access.canManage) throw new ChatError("ลบได้เฉพาะรูปที่ตัวเองเพิ่ม (หรือแอดมินห้อง)", 403);
  await prisma.chatAlbumItem.delete({ where: { id: item.id } });
  await deleteOrphanFiles(actor.orgId, [item.url, ...(item.thumbUrl ? [item.thumbUrl] : [])]);
}

export async function deleteAlbum(actor: ChatActor, albumId: string): Promise<void> {
  const { album, access } = await albumWithAccess(actor, albumId);
  if (album.createdById !== actor.userId && !access.canManage) throw new ChatError("เฉพาะคนสร้างอัลบั้มหรือแอดมินห้อง", 403);
  const items = await prisma.chatAlbumItem.findMany({ where: { orgId: actor.orgId, albumId }, select: { url: true, thumbUrl: true } });
  await prisma.chatAlbum.delete({ where: { id: albumId } });
  await deleteOrphanFiles(actor.orgId, items.flatMap((i) => [i.url, ...(i.thumbUrl ? [i.thumbUrl] : [])]));
}

/**
 * ลบไฟล์ที่ไม่มีใครใช้แล้ว — ไม่อยู่ในอัลบั้มไหน และไม่ได้แนบในข้อความไหนเลย (รูปที่อัปโหลด
 * เข้าอัลบั้มตรง) ไฟล์ที่ยังแนบในแชทอยู่ปล่อยให้งานเก็บกวาดไฟล์หมดอายุจัดการตามอายุ
 */
async function deleteOrphanFiles(orgId: string, urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const stillInAlbum = new Set(
    (await prisma.chatAlbumItem.findMany({ where: { orgId, OR: [{ url: { in: urls } }, { thumbUrl: { in: urls } }] }, select: { url: true, thumbUrl: true } }))
      .flatMap((i) => [i.url, i.thumbUrl])
  );
  const orphans: string[] = [];
  for (const url of urls) {
    if (stillInAlbum.has(url)) continue;
    const inMessage = await prisma.chatMessage.findFirst({
      where: { orgId, OR: [{ attachments: { array_contains: [{ url }] } }, { attachments: { array_contains: [{ thumbUrl: url }] } }] },
      select: { id: true },
    });
    if (!inMessage) orphans.push(url);
  }
  if (orphans.length === 0) return;
  await deleteFiles(orphans);
  await prisma.chatFile.deleteMany({ where: { orgId, url: { in: orphans } } });
}
