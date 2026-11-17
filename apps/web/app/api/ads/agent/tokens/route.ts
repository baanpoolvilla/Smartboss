import { adsRoute, readJson } from "@/modules/ads/data/access";
import { createAgentToken, listAgentTokens } from "@/modules/ads/data/agent-auth";
import { ADS_PERMS } from "@/modules/ads/permissions";

export const dynamic = "force-dynamic";

/** GET /api/ads/agent/tokens — token ของ n8n (ไม่มีตัวเต็ม) */
export const GET = adsRoute(ADS_PERMS.admin, async (_req, session) => ({ tokens: await listAgentTokens(session.orgId) }));

/** POST /api/ads/agent/tokens — { name } ออก token ใหม่ · ตัวเต็มคืนครั้งเดียว */
export const POST = adsRoute(ADS_PERMS.admin, async (req, session) => {
  const body = await readJson(req);
  return createAgentToken(session.orgId, String(body.name ?? ""), session.userId);
});
