import { adsRoute } from "@/modules/ads/data/access";
import { revokeAgentToken } from "@/modules/ads/data/agent-auth";
import { ADS_PERMS } from "@/modules/ads/permissions";

export const dynamic = "force-dynamic";

/** DELETE /api/ads/agent/tokens/:id — ยกเลิก token (n8n ที่ใช้ตัวนี้เรียกไม่ได้ทันที) */
export const DELETE = adsRoute<{ id: string }>(ADS_PERMS.admin, async (_req, session, { id }) => {
  await revokeAgentToken(session.orgId, id);
  return { ok: true };
});
