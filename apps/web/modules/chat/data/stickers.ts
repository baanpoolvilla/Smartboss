import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@smartboss/database";

import { putFile } from "@/lib/storage";
import { sniffMime } from "@/modules/report_task/lib/upload-sniff";
import { checkOrgQuota, toGB } from "@/modules/company-files/lib/quota";
import { ChatError, type ChatActor } from "./serialize";
import type { ChatStickerDTO, ChatStickerPackDTO } from "../types";

/**
 * สติกเกอร์ของบริษัท — แอดมินแชทเพิ่ม/ลบ/จัดหมวด/เรียง ทุกคนในบริษัทใช้ได้ (แชท + รายงาน)
 *
 * ขนาด (กันเปลืองพื้นที่): หน้าเว็บย่อรูปนิ่งเหลือด้านยาวสุด 320 px เป็น WebP ก่อนส่ง (ปกติ 20–80KB)
 * GIF/WebP เคลื่อนไหวส่งตามจริง (ย่อแล้วภาพจะหยุดนิ่ง) จึงจำกัดไฟล์ที่ STICKER_MAX_BYTES
 * ทุกไฟล์นับเข้าเพดานพื้นที่ของบริษัทเหมือนไฟล์แชทอื่น
 */
export const STICKER_MAX_BYTES = 1024 * 1024;
export const STICKER_MAX_COUNT = 300;
const PACK_MAX_COUNT = 50;

const STICKER_TYPES: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/jpeg": "jpg" };

type StickerRow = { id: string; packId: string | null; name: string; keywords: string; url: string; width: number | null; height: number | null };

function toDTO(r: StickerRow): ChatStickerDTO {
  return {
    id: r.id,
    packId: r.packId,
    name: r.name,
    keywords: r.keywords,
    url: r.url,
    ...(r.width ? { width: r.width } : {}),
    ...(r.height ? { height: r.height } : {}),
  };
}

export async function listStickers(orgId: string): Promise<{ packs: ChatStickerPackDTO[]; stickers: ChatStickerDTO[] }> {
  const [packs, stickers] = await Promise.all([
    prisma.chatStickerPack.findMany({
      where: { orgId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.chatSticker.findMany({ where: { orgId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
  ]);
  return { packs, stickers: stickers.map(toDTO) };
}

function requireAdmin(actor: ChatActor): void {
  if (!actor.isChatAdmin) throw new ChatError("เฉพาะแอดมินแชทจัดการสติกเกอร์ได้", 403);
}

async function ownPackId(orgId: string, packId: string | null | undefined): Promise<string | null> {
  if (!packId) return null;
  const pack = await prisma.chatStickerPack.findFirst({ where: { orgId, id: packId }, select: { id: true } });
  if (!pack) throw new ChatError("ไม่พบหมวดนี้", 404);
  return pack.id;
}

async function nextStickerOrder(orgId: string, packId: string | null): Promise<number> {
  const last = await prisma.chatSticker.findFirst({ where: { orgId, packId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  return (last?.sortOrder ?? -1) + 1;
}

/** ชื่อจากชื่อไฟล์ — ไม่ต้องตั้งชื่อก็เพิ่มได้ (แก้ทีหลังในหน้าจัดการ) ชื่อไฟล์จากกล้อง (IMG_1234) ใช้ "สติกเกอร์" */
function nameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return (base && !/^(img|image|photo|screenshot|pxl)?\s*\d[\d\s]*$/i.test(base) ? base : "สติกเกอร์").slice(0, 40);
}

export async function createSticker(
  actor: ChatActor,
  input: { file: File; name?: string; packId?: string | null; width?: number; height?: number }
): Promise<ChatStickerDTO> {
  requireAdmin(actor);
  if (input.file.size === 0) throw new ChatError("ต้องแนบรูป", 400);
  if (input.file.size > STICKER_MAX_BYTES) throw new ChatError("ไฟล์สติกเกอร์ใหญ่เกิน 1 MB — ใช้รูปขนาดไม่เกิน 512×512 px", 413);
  if ((await prisma.chatSticker.count({ where: { orgId: actor.orgId } })) >= STICKER_MAX_COUNT) {
    throw new ChatError(`มีสติกเกอร์ครบ ${STICKER_MAX_COUNT} ตัวแล้ว ลบตัวที่ไม่ใช้ก่อน`, 400);
  }
  const packId = await ownPackId(actor.orgId, input.packId);
  const quota = await checkOrgQuota(actor.orgId, input.file.size);
  if (!quota.ok) throw new ChatError(`พื้นที่เก็บไฟล์ของบริษัทเต็มแล้ว (ใช้ไป ${toGB(quota.used)} จาก ${toGB(quota.limit)} GB)`, 413);

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const mime = sniffMime(bytes, input.file.type);
  const ext = mime ? STICKER_TYPES[mime] : undefined;
  if (!mime || !ext) throw new ChatError("สติกเกอร์ต้องเป็นรูป PNG, WebP, GIF หรือ JPG", 400);

  const url = await putFile(`${actor.orgId}/chat/stickers`, new File([bytes], `${randomUUID()}.${ext}`, { type: mime }), { ext });
  const dim = (v: number | undefined) => (v && Number.isFinite(v) && v > 0 && v <= 4096 ? Math.round(v) : null);
  const sortOrder = await nextStickerOrder(actor.orgId, packId);
  const [, row] = await prisma.$transaction([
    prisma.chatFile.create({ data: { orgId: actor.orgId, uploadedById: actor.userId, url, size: bytes.byteLength, mime, kind: "sticker" } }),
    prisma.chatSticker.create({
      data: {
        orgId: actor.orgId,
        packId,
        name: input.name?.trim().slice(0, 40) || nameFromFile(input.file.name),
        url,
        mime,
        size: bytes.byteLength,
        width: dim(input.width),
        height: dim(input.height),
        sortOrder,
        createdById: actor.userId,
      },
    }),
  ]);
  return toDTO(row);
}

export async function updateSticker(
  actor: ChatActor,
  id: string,
  input: { name?: unknown; keywords?: unknown; packId?: unknown }
): Promise<ChatStickerDTO> {
  requireAdmin(actor);
  const data: { name?: string; keywords?: string; packId?: string | null; sortOrder?: number } = {};
  if (typeof input.name === "string") {
    const name = input.name.trim().slice(0, 40);
    if (!name) throw new ChatError("ชื่อสติกเกอร์ต้องไม่ว่าง", 400);
    data.name = name;
  }
  if (typeof input.keywords === "string") data.keywords = input.keywords.trim().slice(0, 200);
  if (input.packId !== undefined) {
    // ย้ายหมวด = ไปต่อท้ายหมวดใหม่
    data.packId = await ownPackId(actor.orgId, typeof input.packId === "string" ? input.packId : null);
    data.sortOrder = await nextStickerOrder(actor.orgId, data.packId);
  }
  const res = await prisma.chatSticker.updateMany({ where: { orgId: actor.orgId, id }, data });
  if (res.count === 0) throw new ChatError("ไม่พบสติกเกอร์นี้", 404);
  return toDTO((await prisma.chatSticker.findFirst({ where: { orgId: actor.orgId, id } }))!);
}

/** เอาออกจากชุด — ไฟล์ไม่ลบ ข้อความ/คอมเมนต์ที่เคยส่งสติกเกอร์นี้ไปยังแสดงได้ */
export async function deleteSticker(actor: ChatActor, id: string): Promise<void> {
  requireAdmin(actor);
  const res = await prisma.chatSticker.deleteMany({ where: { orgId: actor.orgId, id } });
  if (res.count === 0) throw new ChatError("ไม่พบสติกเกอร์นี้", 404);
}

function packName(name: unknown): string {
  const clean = typeof name === "string" ? name.trim().slice(0, 30) : "";
  if (!clean) throw new ChatError("ตั้งชื่อหมวดก่อน", 400);
  return clean;
}

export async function createPack(actor: ChatActor, name: unknown): Promise<ChatStickerPackDTO> {
  requireAdmin(actor);
  const clean = packName(name);
  if ((await prisma.chatStickerPack.count({ where: { orgId: actor.orgId } })) >= PACK_MAX_COUNT) {
    throw new ChatError(`มีหมวดครบ ${PACK_MAX_COUNT} หมวดแล้ว`, 400);
  }
  const last = await prisma.chatStickerPack.findFirst({ where: { orgId: actor.orgId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  return prisma.chatStickerPack.create({
    data: { orgId: actor.orgId, name: clean, sortOrder: (last?.sortOrder ?? -1) + 1, createdById: actor.userId },
    select: { id: true, name: true },
  });
}

export async function renamePack(actor: ChatActor, id: string, name: unknown): Promise<void> {
  requireAdmin(actor);
  const res = await prisma.chatStickerPack.updateMany({ where: { orgId: actor.orgId, id }, data: { name: packName(name) } });
  if (res.count === 0) throw new ChatError("ไม่พบหมวดนี้", 404);
}

/** ลบหมวด — สติกเกอร์ในหมวดไม่หาย ย้ายไป "ทั่วไป" (ไม่มีหมวด) */
export async function deletePack(actor: ChatActor, id: string): Promise<void> {
  requireAdmin(actor);
  const res = await prisma.chatStickerPack.deleteMany({ where: { orgId: actor.orgId, id } });
  if (res.count === 0) throw new ChatError("ไม่พบหมวดนี้", 404);
}

/** เรียงใหม่ตามลำดับใน array — หมวด และ/หรือ สติกเกอร์ในหมวดเดียวกัน */
export async function reorderStickers(actor: ChatActor, input: { packIds?: unknown; stickerIds?: unknown }): Promise<void> {
  requireAdmin(actor);
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : []);
  await prisma.$transaction([
    ...ids(input.packIds).map((id, i) => prisma.chatStickerPack.updateMany({ where: { orgId: actor.orgId, id }, data: { sortOrder: i } })),
    ...ids(input.stickerIds).map((id, i) => prisma.chatSticker.updateMany({ where: { orgId: actor.orgId, id }, data: { sortOrder: i } })),
  ]);
}
