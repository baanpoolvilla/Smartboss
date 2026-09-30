import { adsRoute, readJson } from "@/modules/ads/data/access";
import { runAnalysis } from "@/modules/ads/data/ai";
import { ADS_PERMS } from "@/modules/ads/permissions";
import { parsePeriodQuery } from "@/modules/ads/lib/query";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/ads/ai-reports — สั่งให้ AI วิเคราะห์ช่วงที่กำหนด
 * body: { customer_id, from, to, compare? } (compare รูปแบบเดียวกับ query string)
 */
export const POST = adsRoute(ADS_PERMS.access, async (req, session) => {
  const body = await readJson(req);
  const params = { get: (k: string) => (typeof body[k] === "string" ? (body[k] as string) : null) };
  const { period, compare } = parsePeriodQuery(params);
  const id = await runAnalysis(session.orgId, String(body.customer_id ?? ""), period, compare, session.userId);
  return { id };
});
