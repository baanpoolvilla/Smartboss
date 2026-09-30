import { adsRoute } from "@/modules/ads/data/access";
import { listSyncLogs } from "@/modules/ads/data/sync";
import { ADS_PERMS } from "@/modules/ads/permissions";

export const dynamic = "force-dynamic";

/** GET /api/ads/sync-logs?customer_id= — ประวัติการซิงค์ */
export const GET = adsRoute(ADS_PERMS.admin, async (req, session) => {
  const customerId = new URL(req.url).searchParams.get("customer_id");
  return { logs: await listSyncLogs(session.orgId, customerId) };
});
