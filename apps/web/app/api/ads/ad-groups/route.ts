import { prisma } from "@smartboss/database";
import { adsRoute } from "@/modules/ads/data/access";
import { buildReport } from "@/modules/ads/data/report";
import { ADS_PERMS } from "@/modules/ads/permissions";
import { parsePeriodQuery } from "@/modules/ads/lib/query";

export const dynamic = "force-dynamic";

/** GET /api/ads/ad-groups?campaign_id=&from=&to= — ตารางกลุ่มโฆษณาพร้อมสถานะ */
export const GET = adsRoute(ADS_PERMS.access, async (req, session) => {
  const sp = new URL(req.url).searchParams;
  const campaignId = sp.get("campaign_id") ?? "";
  if (!/^\d+$/.test(campaignId)) throw new Error("ต้องระบุ campaign_id");
  const campaign = await prisma.adsCampaign.findFirst({
    where: { orgId: session.orgId, campaignId: BigInt(campaignId) },
    select: { customerId: true },
  });
  if (!campaign) throw new Error("ไม่พบแคมเปญนี้");
  const { period } = parsePeriodQuery(sp);
  const r = await buildReport(session.orgId, campaign.customerId, period, null);
  return { period: r.period, ad_groups: r.adGroups.filter((a) => a.campaign_id === campaignId) };
});
