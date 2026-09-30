import { adsRoute, readJson } from "@/modules/ads/data/access";
import { updateActionStatus } from "@/modules/ads/data/ai";
import { ADS_PERMS } from "@/modules/ads/permissions";

export const dynamic = "force-dynamic";

/** PATCH /api/ads/ai-actions/{id} — อัปเดตสถานะแผนปฏิบัติการ { status } */
export const PATCH = adsRoute<{ id: string }>(ADS_PERMS.access, async (req, session, { id }) => {
  const body = await readJson(req);
  await updateActionStatus(session.orgId, id, String(body.status ?? ""));
  return { ok: true };
});
