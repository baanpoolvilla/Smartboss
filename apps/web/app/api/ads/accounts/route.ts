import { adsRoute, readJson } from "@/modules/ads/data/access";
import { discoverAccounts, listAccounts, setSyncEnabled } from "@/modules/ads/data/accounts";
import { isSyncing } from "@/modules/ads/data/sync";
import { ADS_PERMS } from "@/modules/ads/permissions";

export const dynamic = "force-dynamic";

/** GET /api/ads/accounts — รายชื่อบัญชีและสถานะซิงค์ (spec §8) */
export const GET = adsRoute(ADS_PERMS.access, async (_req, session) => {
  const accounts = await listAccounts(session.orgId);
  return { accounts: accounts.map((a) => ({ ...a, syncing: isSyncing(a.customerId) })) };
});

/** POST /api/ads/accounts — ดึงรายชื่อบัญชีใต้ MCC มาเก็บ (หน้า 4 "บัญชีที่ดึง") */
export const POST = adsRoute(ADS_PERMS.admin, async (_req, session) => discoverAccounts(session.orgId));

/** PATCH /api/ads/accounts — เปิด/ปิดการซิงค์ของบัญชี { customer_id, sync_enabled } */
export const PATCH = adsRoute(ADS_PERMS.admin, async (req, session) => {
  const body = await readJson(req);
  await setSyncEnabled(session.orgId, String(body.customer_id ?? ""), body.sync_enabled === true);
  return { ok: true };
});
