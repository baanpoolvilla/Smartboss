import { adsRoute } from "@/modules/ads/data/access";
import { buildReport } from "@/modules/ads/data/report";
import { ADS_PERMS } from "@/modules/ads/permissions";
import { parsePeriodQuery } from "@/modules/ads/lib/query";

export const dynamic = "force-dynamic";

/** GET /api/ads/summary?customer_id=&from=&to=&compare= — KPI รวม + สถานะ + การเปลี่ยนแปลง */
export const GET = adsRoute(ADS_PERMS.access, async (req, session) => {
  const sp = new URL(req.url).searchParams;
  const { period, compare } = parsePeriodQuery(sp);
  const r = await buildReport(session.orgId, sp.get("customer_id") ?? "", period, compare);
  return {
    account: r.account,
    period: r.period,
    compare: r.compare,
    totals: r.totals,
    benchmarks: r.benchmarks,
    rule_findings: r.findings,
  };
});
