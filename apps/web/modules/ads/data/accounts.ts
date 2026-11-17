import "server-only";
import { prisma } from "@smartboss/database";

export interface AdsAccountRow {
  customerId: string;
  name: string | null;
  currencyCode: string | null;
  timeZone: string | null;
  syncEnabled: boolean;
  lastSyncedAt: Date | null;
}

export async function listAccounts(orgId: string): Promise<AdsAccountRow[]> {
  return prisma.adsAccount.findMany({
    where: { orgId },
    orderBy: { name: "asc" },
    select: { customerId: true, name: true, currencyCode: true, timeZone: true, syncEnabled: true, lastSyncedAt: true },
  });
}

export async function getAccount(orgId: string, customerId: string): Promise<AdsAccountRow | null> {
  return prisma.adsAccount.findFirst({
    where: { orgId, customerId },
    select: { customerId: true, name: true, currencyCode: true, timeZone: true, syncEnabled: true, lastSyncedAt: true },
  });
}

/** บัญชีที่เลือกจาก query string — ไม่ระบุหรือไม่พบ ใช้บัญชีแรกของบริษัท */
export async function resolveAccount(orgId: string, customerId: string | null | undefined): Promise<AdsAccountRow | null> {
  const accounts = await listAccounts(orgId);
  return accounts.find((a) => a.customerId === customerId) ?? accounts[0] ?? null;
}

/** เวลาที่ n8n ส่งข้อมูลเข้ามาครบรอบล่าสุด (แสดงทุกหน้า) */
export async function lastSyncedAt(orgId: string, customerId?: string | null): Promise<Date | null> {
  const row = await prisma.adsAccount.findFirst({
    where: { orgId, ...(customerId ? { customerId } : {}), lastSyncedAt: { not: null } },
    orderBy: { lastSyncedAt: "desc" },
    select: { lastSyncedAt: true },
  });
  return row?.lastSyncedAt ?? null;
}

/** ประวัติการรับข้อมูลจาก n8n (แถวเก่าก่อน 17/11/2569 คือการซิงค์ของระบบเดิม) */
export async function listSyncLogs(orgId: string, customerId?: string | null, take = 50) {
  return prisma.adsSyncLog.findMany({
    where: { orgId, ...(customerId ? { customerId } : {}) },
    orderBy: { startedAt: "desc" },
    take,
  });
}
