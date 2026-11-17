import { agentRoute, readAgentJson } from "@/modules/ads/data/agent-auth";
import { touchAgentSeen } from "@/modules/ads/data/agent-settings";

export const dynamic = "force-dynamic";

/** POST /api/agent/ads/heartbeat — n8n บอกว่ายังออนไลน์ { version?, workflow?, note? } (แนะนำทุก 5 นาที) */
export const POST = agentRoute(async (req, ctx) => {
  const body = await readAgentJson(req).catch(() => ({}) as Record<string, unknown>);
  const info = Object.fromEntries(
    Object.entries(body)
      .slice(0, 10)
      .map(([k, v]) => [k.slice(0, 40), typeof v === "string" ? v.slice(0, 200) : v])
  );
  await touchAgentSeen(ctx.orgId, { ...info, at: new Date().toISOString() });
  return { ok: true, org_id: ctx.orgId, server_time: new Date().toISOString() };
});
