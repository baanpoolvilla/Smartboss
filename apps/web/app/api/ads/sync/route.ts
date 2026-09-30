import { after } from "next/server";
import { adsRoute, readJson } from "@/modules/ads/data/access";
import { getAccount, listAccounts } from "@/modules/ads/data/accounts";
import { isSyncing, runSync, syncRange } from "@/modules/ads/data/sync";
import { ADS_PERMS } from "@/modules/ads/permissions";

export const dynamic = "force-dynamic";

/**
 * POST /api/ads/sync — สั่งซิงค์ทันที (spec §3.1)
 * body: { customer_id?, job_type?: "manual" | "backfill", months?: 12–24 }
 * ไม่ระบุ customer_id = ทุกบัญชีที่เปิดซิงค์ · งานรันเบื้องหลังหลังตอบกลับแล้ว
 * ดูผลที่ GET /api/ads/sync-logs
 */
export const POST = adsRoute(ADS_PERMS.admin, async (req, session) => {
  const body = await readJson(req);
  const jobType = body.job_type === "backfill" ? "backfill" : "manual";
  const months = Number(body.months ?? 24);
  const customerId = typeof body.customer_id === "string" && body.customer_id ? body.customer_id : null;

  const targets = customerId
    ? [await getAccount(session.orgId, customerId)].filter((a) => a != null)
    : (await listAccounts(session.orgId)).filter((a) => a.syncEnabled);
  if (targets.length === 0) throw new Error(customerId ? "ไม่พบบัญชีโฆษณานี้" : "ไม่มีบัญชีที่เปิดซิงค์");
  const busy = targets.filter((a) => isSyncing(a.customerId));
  if (busy.length > 0) throw new Error(`กำลังซิงค์อยู่: ${busy.map((a) => a.name ?? a.customerId).join(", ")}`);

  after(async () => {
    for (const a of targets) {
      try {
        await runSync(session.orgId, a.customerId, jobType, { backfillMonths: months });
      } catch (err) {
        console.error(`[ads-sync] ${a.customerId}:`, err);
      }
    }
  });

  return {
    started: targets.map((a) => ({ customerId: a.customerId, range: syncRange(jobType, a.timeZone, months) })),
    job_type: jobType,
  };
});
