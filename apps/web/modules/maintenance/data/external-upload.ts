import "server-only";
import { prisma } from "@smartboss/database";
import { randomBytes } from "node:crypto";

/** สร้างลิงก์อัปโหลดใหม่ (revoke ของเก่า) คืน token */
export async function createUploadLink(
  orgId: string,
  workOrderId: string
): Promise<string> {
  await prisma.workOrderUploadLink.updateMany({
    where: { orgId, workOrderId, revoked: false },
    data: { revoked: true },
  });
  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  await prisma.workOrderUploadLink.create({
    data: { orgId, workOrderId, token, expiresAt, revoked: false },
  });
  return token;
}

export function getActiveUploadLink(orgId: string, workOrderId: string) {
  return prisma.workOrderUploadLink.findFirst({
    where: { orgId, workOrderId, revoked: false },
    orderBy: { createdAt: "desc" },
  });
}

/** context สาธารณะจาก token (ไม่ต้อง login) */
export async function getUploadContext(token: string) {
  const link = await prisma.workOrderUploadLink.findUnique({ where: { token } });
  if (!link || link.revoked) return null;
  if (link.expiresAt && link.expiresAt < new Date()) return null;
  const wo = await prisma.workOrder.findUnique({
    where: { id: link.workOrderId },
    select: { title: true, property: { select: { name: true } } },
  });
  if (!wo) return null;
  return {
    token,
    orgId: link.orgId,
    workOrderId: link.workOrderId,
    title: wo.title,
    propertyName: wo.property?.name ?? null,
  };
}

/** ตัดข้อความช่างนอกที่ 500 ตัว — ตรงกับ changyai migration 066 */
const NOTE_MAX = 500;

/**
 * บันทึกรูปจากช่างนอก พร้อมข้อความที่พิมพ์มา (ถ้ามี)
 *
 * ช่างนอกไม่มีบัญชีในระบบจึงคอมเมนต์ตามปกติไม่ได้ เมื่อก่อนส่งได้แต่รูปเปล่า ๆ
 * แล้วต้องโทรถามว่ารูปนี้คืออะไร
 *
 * ⚠ ต้องตัดความยาวและ trim ที่นี่ ไม่ใช่แค่ `maxLength` ในฟอร์ม — หน้านี้เปิด
 * สาธารณะด้วย token ใครก็ยิง request ตรงเข้ามาได้โดยไม่ผ่านหน้าจอ
 */
export async function registerExternalPhoto(
  token: string,
  storagePath: string,
  note?: string | null
): Promise<boolean> {
  const link = await prisma.workOrderUploadLink.findUnique({ where: { token } });
  if (!link || link.revoked) return false;
  if (link.expiresAt && link.expiresAt < new Date()) return false;
  const clean = (note ?? "").slice(0, NOTE_MAX).trim();
  await prisma.workOrderExternalPhoto.create({
    data: {
      orgId: link.orgId,
      workOrderId: link.workOrderId,
      storagePath,
      note: clean || null,
    },
  });
  return true;
}

/**
 * บันทึกข้อความเปล่า ๆ โดยไม่มีรูป
 *
 * แยกจากด้านบนเพราะ `storage_path` เป็น NOT NULL — ช่างที่อยากบอกว่า
 * "เข้าไม่ได้ ประตูล็อก" ไม่มีรูปจะส่ง จึงเก็บเป็น path ว่างแล้วให้ฝั่งแสดงผล
 * ข้ามรูปที่ path ว่าง
 */
export async function registerExternalNote(
  token: string,
  note: string
): Promise<boolean> {
  const clean = note.slice(0, NOTE_MAX).trim();
  if (!clean) return false;
  return registerExternalPhoto(token, "", clean);
}

export function listExternalPhotos(orgId: string, workOrderId: string) {
  return prisma.workOrderExternalPhoto.findMany({
    where: { orgId, workOrderId },
    orderBy: { uploadedAt: "asc" },
  });
}
