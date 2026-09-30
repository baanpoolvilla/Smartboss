import { adsRoute } from "@/modules/ads/data/access";
import { getAiReport } from "@/modules/ads/data/ai";
import { ADS_PERMS } from "@/modules/ads/permissions";

export const dynamic = "force-dynamic";

/** GET /api/ads/ai-reports/{id} — ดึงรายงาน AI */
export const GET = adsRoute<{ id: string }>(ADS_PERMS.access, async (_req, session, { id }) => {
  const report = await getAiReport(session.orgId, id);
  if (!report) return Response.json({ error: "ไม่พบรายงานนี้" }, { status: 404 });
  return report;
});
