import "server-only";
import { prisma } from "@smartboss/database";
import { listClientAccounts } from "../lib/google-ads-client";

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

/**
 * ดึงรายชื่อบัญชีใต้ MCC มาเก็บ (spec §2: ผูกบัญชีโฆษณาทั้งหมดไว้ใต้ MCC)
 * บัญชีใหม่เปิดซิงค์เป็นค่าเริ่มต้น (ads_accounts.sync_enabled DEFAULT TRUE)
 * บัญชีที่ผูกกับบริษัทอื่นไว้แล้วจะข้าม — customer_id เป็น PK ทั้งระบบ
 */
export async function discoverAccounts(orgId: string): Promise<{ added: number; updated: number; skipped: number }> {
  const found = await listClientAccounts();
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const acc of found) {
    const existing = await prisma.adsAccount.findUnique({ where: { customerId: acc.customerId }, select: { orgId: true } });
    if (existing && existing.orgId !== orgId) {
      skipped++;
      continue;
    }
    const data = { name: acc.name, currencyCode: acc.currencyCode, timeZone: acc.timeZone };
    if (existing) {
      await prisma.adsAccount.update({ where: { customerId: acc.customerId }, data });
      updated++;
    } else {
      await prisma.adsAccount.create({ data: { customerId: acc.customerId, orgId, ...data } });
      added++;
    }
  }
  return { added, updated, skipped };
}

export async function setSyncEnabled(orgId: string, customerId: string, enabled: boolean): Promise<void> {
  const res = await prisma.adsAccount.updateMany({ where: { orgId, customerId }, data: { syncEnabled: enabled } });
  if (res.count === 0) throw new Error("ไม่พบบัญชีโฆษณานี้");
}

/** เวลาซิงค์ล่าสุดของบริษัท (แสดงทุกหน้า — spec §7 ฟังก์ชันร่วม) */
export async function lastSyncedAt(orgId: string, customerId?: string | null): Promise<Date | null> {
  const row = await prisma.adsAccount.findFirst({
    where: { orgId, ...(customerId ? { customerId } : {}), lastSyncedAt: { not: null } },
    orderBy: { lastSyncedAt: "desc" },
    select: { lastSyncedAt: true },
  });
  return row?.lastSyncedAt ?? null;
}
