import { adsRoute, readJson } from "@/modules/ads/data/access";
import { rotateWebhookSecret, saveAgentSettings } from "@/modules/ads/data/agent-settings";
import { sendAgentWebhook } from "@/modules/ads/data/webhooks";
import { ADS_PERMS } from "@/modules/ads/permissions";

export const dynamic = "force-dynamic";

/** POST /api/ads/agent/settings — { webhook_url, allowed_types, max_budget_change_pct, proposal_expiry_hours, self_approve } */
export const POST = adsRoute(ADS_PERMS.admin, async (req, session) => {
  await saveAgentSettings(session.orgId, await readJson(req));
  return { ok: true };
});

/** PUT /api/ads/agent/settings — { action: "rotate_secret" | "ping" } */
export const PUT = adsRoute(ADS_PERMS.admin, async (req, session) => {
  const body = await readJson(req);
  if (body.action === "rotate_secret") return { secret: await rotateWebhookSecret(session.orgId) };
  if (body.action === "ping") return sendAgentWebhook(session.orgId, "ping", { message: "ทดสอบจากหน้า การเชื่อมต่อ n8n" });
  throw new Error("action ไม่รู้จัก");
});
