import { adsRoute } from "@/modules/ads/data/access";
import { buildReport } from "@/modules/ads/data/report";
import { ADS_PERMS } from "@/modules/ads/permissions";
import { parsePeriodQuery } from "@/modules/ads/lib/query";

export const dynamic = "force-dynamic";

/** GET /api/ads/search-terms/wasted?customer_id=&from=&to= — คำค้นหาที่เสียเงิน (§5.4) */
export const GET = adsRoute(ADS_PERMS.access, async (req, session) => {
  const sp = new URL(req.url).searchParams;
  const { period } = parsePeriodQuery(sp);
  const r = await buildReport(session.orgId, sp.get("customer_id") ?? "", period, null);
  const names = new Map(r.adGroups.map((a) => [a.id, a.name]));
  return {
    period: r.period,
    min_clicks: r.settings.wastedTermMinClicks,
    search_terms: r.wastedTerms.map((w) => ({ ...w, ad_group_name: names.get(w.ad_group_id) ?? null })),
  };
});
