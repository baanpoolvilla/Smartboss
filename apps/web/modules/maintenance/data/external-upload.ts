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

export async function registerExternalPhoto(
  token: string,
  storagePath: string
): Promise<boolean> {
  const link = await prisma.workOrderUploadLink.findUnique({ where: { token } });
  if (!link || link.revoked) return false;
  if (link.expiresAt && link.expiresAt < new Date()) return false;
  await prisma.workOrderExternalPhoto.create({
    data: { orgId: link.orgId, workOrderId: link.workOrderId, storagePath },
  });
  return true;
}

export function listExternalPhotos(orgId: string, workOrderId: string) {
  return prisma.workOrderExternalPhoto.findMany({
    where: { orgId, workOrderId },
    orderBy: { uploadedAt: "asc" },
  });
}
