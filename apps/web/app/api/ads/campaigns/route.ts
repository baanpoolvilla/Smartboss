import { adsRoute } from "@/modules/ads/data/access";
import { buildReport } from "@/modules/ads/data/report";
import { ADS_PERMS } from "@/modules/ads/permissions";
import { parsePeriodQuery } from "@/modules/ads/lib/query";

export const dynamic = "force-dynamic";

/** GET /api/ads/campaigns?customer_id=&from=&to= — ตารางแคมเปญพร้อมสถานะ */
export const GET = adsRoute(ADS_PERMS.access, async (req, session) => {
  const sp = new URL(req.url).searchParams;
  const { period, compare } = parsePeriodQuery(sp);
  const r = await buildReport(session.orgId, sp.get("customer_id") ?? "", period, compare);
  return { period: r.period, compare: r.compare, campaigns: r.campaigns };
});
